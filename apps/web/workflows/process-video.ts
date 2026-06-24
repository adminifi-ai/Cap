import { db } from "@cap/database";
import { videos, videoUploads } from "@cap/database/schema";
import { serverEnv } from "@cap/env";
import { S3Buckets } from "@cap/web-backend";
import type { S3Bucket, Video } from "@cap/web-domain";
import { eq } from "drizzle-orm";
import { Option } from "effect";
import { FatalError } from "workflow";
import { getMediaServerWebhookUrl } from "@/lib/media-client";
import { runPromise } from "@/lib/server";

interface ProcessVideoWorkflowPayload {
	videoId: string;
	userId: string;
	rawFileKey: string;
	bucketId: string | null;
}

interface VideoProcessingResult {
	success: boolean;
	message: string;
	metadata?: {
		duration: number;
		width: number;
		height: number;
		fps: number;
	};
}

function getValidDuration(duration: number) {
	return Number.isFinite(duration) && duration > 0 ? duration : undefined;
}

export async function processVideoWorkflow(
	payload: ProcessVideoWorkflowPayload,
): Promise<VideoProcessingResult> {
	"use workflow";

	const { videoId, userId, rawFileKey, bucketId } = payload;

	try {
		await validateProcessingRequest(videoId, rawFileKey);

		const result = await processVideoOnMediaServer(
			videoId,
			userId,
			rawFileKey,
			bucketId,
		);

		await saveMetadataAndComplete(videoId, result.metadata);
		await cleanupRawUpload(rawFileKey, bucketId);

		return {
			success: true,
			message: "Video processing completed",
			metadata: result.metadata,
		};
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		await setProcessingError(videoId, errorMessage);
		throw new FatalError(errorMessage);
	}
}

async function validateProcessingRequest(
	videoId: string,
	rawFileKey: string,
): Promise<void> {
	"use step";

	const mediaServerUrl = serverEnv().MEDIA_SERVER_URL;
	if (!mediaServerUrl) {
		throw new FatalError("MEDIA_SERVER_URL is not configured");
	}

	const [video] = await db()
		.select()
		.from(videos)
		.where(eq(videos.id, videoId as Video.VideoId));

	if (!video) {
		throw new FatalError("Video does not exist");
	}

	const [upload] = await db()
		.select()
		.from(videoUploads)
		.where(eq(videoUploads.videoId, videoId as Video.VideoId));

	if (!upload) {
		throw new FatalError("Upload does not exist");
	}

	if (upload.rawFileKey !== rawFileKey) {
		throw new FatalError("Upload raw file key does not match");
	}

	if (upload.phase !== "processing") {
		throw new FatalError("Upload is not ready for processing");
	}
}

interface MediaServerProcessResult {
	metadata: {
		duration: number;
		width: number;
		height: number;
		fps: number;
	};
}

const MEDIA_SERVER_START_MAX_ATTEMPTS = 6;
const MEDIA_SERVER_START_RETRY_BASE_MS = 2000;
const MEDIA_SERVER_COMPLETION_MAX_ATTEMPTS = 720;
const MEDIA_SERVER_COMPLETION_POLL_INTERVAL_MS = 5000;

function isPositiveNumber(value: number | null): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function getInputExtension(rawFileKey: string): string {
	const parts = rawFileKey.split(".");
	const extension = parts.at(-1)?.toLowerCase();

	if (!extension) {
		return ".mp4";
	}

	return `.${extension}`;
}

async function waitForRetry(delayMs: number): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function startMediaServerProcessJob(
	mediaServerUrl: string,
	body: {
		videoId: string;
		userId: string;
		videoUrl: string;
		outputPresignedUrl: string;
		thumbnailPresignedUrl: string;
		webhookUrl: string;
		webhookSecret?: string;
		inputExtension: string;
	},
): Promise<string> {
	for (let attempt = 0; attempt < MEDIA_SERVER_START_MAX_ATTEMPTS; attempt++) {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
		};
		if (body.webhookSecret) {
			headers["x-media-server-secret"] = body.webhookSecret;
		}

		const response = await fetch(`${mediaServerUrl}/video/process`, {
			method: "POST",
			headers,
			body: JSON.stringify(body),
		});

		if (response.ok) {
			const { jobId } = (await response.json()) as { jobId: string };
			return jobId;
		}

		const errorData = (await response.json().catch(() => ({}))) as {
			error?: string;
			code?: string;
			details?: string;
			instanceId?: string;
			pid?: number;
			activeVideoProcesses?: number;
			maxConcurrentVideoProcesses?: number;
			jobCount?: number;
		};
		const baseErrorMessage =
			errorData.error ||
			errorData.details ||
			"Video processing failed to start";
		const busyDiagnostics =
			errorData.code === "SERVER_BUSY"
				? [
						errorData.instanceId ? `instance=${errorData.instanceId}` : null,
						typeof errorData.pid === "number" ? `pid=${errorData.pid}` : null,
						typeof errorData.activeVideoProcesses === "number" &&
						typeof errorData.maxConcurrentVideoProcesses === "number"
							? `active=${errorData.activeVideoProcesses}/${errorData.maxConcurrentVideoProcesses}`
							: null,
						typeof errorData.jobCount === "number"
							? `jobCount=${errorData.jobCount}`
							: null,
					]
						.filter(Boolean)
						.join(", ")
				: "";
		const errorMessage = busyDiagnostics
			? `${baseErrorMessage} (${busyDiagnostics})`
			: baseErrorMessage;
		const shouldRetry =
			response.status === 503 &&
			(errorData.code === "SERVER_BUSY" ||
				errorMessage.includes("Server is busy"));

		if (shouldRetry && attempt < MEDIA_SERVER_START_MAX_ATTEMPTS - 1) {
			await waitForRetry(MEDIA_SERVER_START_RETRY_BASE_MS * 2 ** attempt);
			continue;
		}

		throw new Error(errorMessage);
	}

	throw new Error("Video processing failed to start");
}

async function processVideoOnMediaServer(
	videoId: string,
	userId: string,
	rawFileKey: string,
	bucketId: string | null,
): Promise<MediaServerProcessResult> {
	"use step";

	const mediaServerUrl = serverEnv().MEDIA_SERVER_URL;
	if (!mediaServerUrl) {
		throw new FatalError("MEDIA_SERVER_URL is not configured");
	}

	const [bucket] = await S3Buckets.getBucketAccess(
		Option.fromNullable(bucketId as S3Bucket.S3BucketId | null),
	).pipe(runPromise);

	const rawVideoUrl = await bucket
		.getInternalSignedObjectUrl(rawFileKey)
		.pipe(runPromise);

	const outputKey = `${userId}/${videoId}/result.mp4`;
	const thumbnailKey = `${userId}/${videoId}/screenshot/screen-capture.jpg`;

	const outputPresignedUrl = await bucket
		.getInternalPresignedPutUrl(outputKey, {
			ContentType: "video/mp4",
		})
		.pipe(runPromise);

	const thumbnailPresignedUrl = await bucket
		.getInternalPresignedPutUrl(thumbnailKey, {
			ContentType: "image/jpeg",
		})
		.pipe(runPromise);

	const webhookUrl = getMediaServerWebhookUrl();
	const webhookSecret = serverEnv().MEDIA_SERVER_WEBHOOK_SECRET;

	await startMediaServerProcessJob(mediaServerUrl, {
		videoId,
		userId,
		videoUrl: rawVideoUrl,
		outputPresignedUrl,
		thumbnailPresignedUrl,
		webhookUrl,
		webhookSecret: webhookSecret || undefined,
		inputExtension: getInputExtension(rawFileKey),
	});

	return await waitForProcessingCompletion(videoId);
}

function getMetadataFromVideoRow(
	video:
		| {
				duration: number | null;
				width: number | null;
				height: number | null;
				fps: number | null;
		  }
		| undefined,
): MediaServerProcessResult["metadata"] | null {
	if (
		!video ||
		!isPositiveNumber(video.width) ||
		!isPositiveNumber(video.height) ||
		!isPositiveNumber(video.fps)
	) {
		return null;
	}

	return {
		duration: isPositiveNumber(video.duration) ? video.duration : 0,
		width: video.width,
		height: video.height,
		fps: video.fps,
	};
}

async function getCompletedMetadata(
	videoId: string,
): Promise<MediaServerProcessResult["metadata"] | null> {
	const [video] = await db()
		.select({
			duration: videos.duration,
			width: videos.width,
			height: videos.height,
			fps: videos.fps,
		})
		.from(videos)
		.where(eq(videos.id, videoId as Video.VideoId));

	return getMetadataFromVideoRow(video);
}

async function waitForProcessingCompletion(
	videoId: string,
): Promise<MediaServerProcessResult> {
	let lastStatus = "processing";

	for (
		let attempt = 0;
		attempt < MEDIA_SERVER_COMPLETION_MAX_ATTEMPTS;
		attempt++
	) {
		await waitForRetry(MEDIA_SERVER_COMPLETION_POLL_INTERVAL_MS);

		const [upload] = await db()
			.select({
				phase: videoUploads.phase,
				processingProgress: videoUploads.processingProgress,
				processingMessage: videoUploads.processingMessage,
				processingError: videoUploads.processingError,
			})
			.from(videoUploads)
			.where(eq(videoUploads.videoId, videoId as Video.VideoId));

		if (!upload || upload.phase === "complete") {
			const metadata = await getCompletedMetadata(videoId);
			if (!metadata) {
				throw new Error("Processing completed but video metadata is missing");
			}

			return { metadata };
		}

		if (upload.phase === "error") {
			throw new Error(
				upload.processingError ||
					upload.processingMessage ||
					"Video processing failed",
			);
		}

		lastStatus = [
			upload.phase,
			typeof upload.processingProgress === "number"
				? `${upload.processingProgress}%`
				: null,
			upload.processingMessage,
		]
			.filter(Boolean)
			.join(" ");
	}

	throw new Error(`Video processing timed out while ${lastStatus}`);
}

async function saveMetadataAndComplete(
	videoId: string,
	metadata: { duration: number; width: number; height: number; fps: number },
): Promise<void> {
	"use step";

	const duration = getValidDuration(metadata.duration);

	await db()
		.update(videos)
		.set({
			width: metadata.width,
			height: metadata.height,
			fps: metadata.fps,
			...(duration === undefined ? {} : { duration }),
		})
		.where(eq(videos.id, videoId as Video.VideoId));

	await db()
		.delete(videoUploads)
		.where(eq(videoUploads.videoId, videoId as Video.VideoId));
}

async function cleanupRawUpload(
	rawFileKey: string,
	bucketId: string | null,
): Promise<void> {
	"use step";

	try {
		const [bucket] = await S3Buckets.getBucketAccess(
			Option.fromNullable(bucketId as S3Bucket.S3BucketId | null),
		).pipe(runPromise);

		await bucket.deleteObject(rawFileKey).pipe(runPromise);
	} catch (error) {
		console.error("[process-video] Failed to delete raw upload", error);
	}
}

async function setProcessingError(
	videoId: string,
	errorMessage: string,
): Promise<void> {
	"use step";

	await db()
		.update(videoUploads)
		.set({
			phase: "error",
			processingProgress: 0,
			processingMessage: "Video processing failed",
			processingError: errorMessage,
			updatedAt: new Date(),
		})
		.where(eq(videoUploads.videoId, videoId as Video.VideoId));
}
