"use server";

import { db } from "@cap/database";
import { getCurrentUser } from "@cap/database/auth/session";
import { videos } from "@cap/database/schema";
import type { LinkedPrd, VideoMetadata } from "@cap/database/types";
import { serverEnv } from "@cap/env";
import type { Video } from "@cap/web-domain";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export type PrdSearchResult = {
	id: string;
	slug: string;
	name: string;
	capabilitySlug: string | null;
};

function workAppConfig() {
	const env = serverEnv();
	if (!env.WORK_APP_URL || !env.WORK_APP_API_KEY) {
		throw new Error("PRD linking is not configured on this server");
	}
	return {
		baseUrl: env.WORK_APP_URL.replace(/\/$/, ""),
		apiKey: env.WORK_APP_API_KEY,
	};
}

async function workAppFetch(path: string, init?: RequestInit) {
	const { baseUrl, apiKey } = workAppConfig();
	const response = await fetch(`${baseUrl}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer apollo:${apiKey}`,
			"Content-Type": "application/json",
			...init?.headers,
		},
		cache: "no-store",
	});
	const data = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(
			(data as { error?: string })?.error ??
				`Work app error ${response.status}`,
		);
	}
	return data;
}

async function getOwnedVideo(videoId: Video.VideoId) {
	const user = await getCurrentUser();
	if (!user) throw new Error("Unauthorized");

	const [video] = await db()
		.select()
		.from(videos)
		.where(eq(videos.id, videoId));
	if (!video) throw new Error("Video not found");
	if (video.ownerId !== user.id)
		throw new Error("You don't have permission to update this video");

	return video;
}

export async function listPrds(): Promise<PrdSearchResult[]> {
	const user = await getCurrentUser();
	if (!user) throw new Error("Unauthorized");

	const [prdsData, capsData] = await Promise.all([
		workAppFetch("/api/planning/prds") as Promise<{
			prds?: {
				id: string;
				slug: string;
				name: string;
				capability_id: string;
			}[];
		}>,
		workAppFetch("/api/planning/capabilities") as Promise<{
			capabilities?: { id: string; slug: string }[];
		}>,
	]);

	const capabilitySlugById = new Map(
		(capsData.capabilities ?? []).map((c) => [c.id, c.slug]),
	);

	return (prdsData.prds ?? []).map((p) => ({
		id: p.id,
		slug: p.slug,
		name: p.name,
		capabilitySlug: capabilitySlugById.get(p.capability_id) ?? null,
	}));
}

export async function linkVideoToPrd(
	videoId: Video.VideoId,
	prd: PrdSearchResult,
) {
	const video = await getOwnedVideo(videoId);
	const { baseUrl } = workAppConfig();

	const shareUrl = `${serverEnv().WEB_URL}/s/${videoId}`;
	const data = (await workAppFetch(`/api/planning/prds/${prd.id}/videos`, {
		method: "POST",
		body: JSON.stringify({ url: shareUrl, title: video.name }),
	})) as { video: { id: string } };

	const metadata: VideoMetadata = video.metadata ?? {};
	const linked: LinkedPrd = {
		prdId: prd.id,
		prdVideoId: data.video.id,
		slug: prd.slug,
		name: prd.name,
		url: prd.capabilitySlug
			? `${baseUrl}/build/capability/${prd.capabilitySlug}/prd`
			: baseUrl,
	};
	const linkedPrds = [
		...(metadata.linkedPrds ?? []).filter((l) => l.prdId !== prd.id),
		linked,
	];

	await db()
		.update(videos)
		.set({ metadata: { ...metadata, linkedPrds } })
		.where(eq(videos.id, videoId));

	revalidatePath(`/s/${videoId}`);

	return { success: true, linkedPrd: linked };
}

export async function unlinkVideoFromPrd(
	videoId: Video.VideoId,
	prdId: string,
) {
	const video = await getOwnedVideo(videoId);

	const metadata: VideoMetadata = video.metadata ?? {};
	const target = (metadata.linkedPrds ?? []).find((l) => l.prdId === prdId);
	if (!target) throw new Error("This video is not linked to that PRD");

	try {
		await workAppFetch(
			`/api/planning/prds/${target.prdId}/videos/${target.prdVideoId}`,
			{ method: "DELETE" },
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : "";
		if (!message.includes("not found")) throw error;
	}

	const linkedPrds = (metadata.linkedPrds ?? []).filter(
		(l) => l.prdId !== prdId,
	);

	await db()
		.update(videos)
		.set({ metadata: { ...metadata, linkedPrds } })
		.where(eq(videos.id, videoId));

	revalidatePath(`/s/${videoId}`);

	return { success: true };
}
