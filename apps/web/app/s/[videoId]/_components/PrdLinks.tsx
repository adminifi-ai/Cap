"use client";

import type { LinkedPrd } from "@cap/database/types";
import { Button } from "@cap/ui";
import type { Video } from "@cap/web-domain";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, FileText, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
	linkVideoToPrd,
	listPrds,
	type PrdSearchResult,
	unlinkVideoFromPrd,
} from "@/actions/videos/prd-links";

export const PrdLinks = ({
	videoId,
	linkedPrds,
	isOwner,
}: {
	videoId: Video.VideoId;
	linkedPrds: LinkedPrd[];
	isOwner: boolean;
}) => {
	const { refresh } = useRouter();
	const queryClient = useQueryClient();
	const [pickerOpen, setPickerOpen] = useState(false);
	const [search, setSearch] = useState("");
	const pickerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!pickerOpen) return;
		const handler = (e: MouseEvent) => {
			if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
				setPickerOpen(false);
			}
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [pickerOpen]);

	const prdsQuery = useQuery({
		queryKey: ["work-app-prds"],
		queryFn: () => listPrds(),
		enabled: pickerOpen,
		staleTime: 5 * 60 * 1000,
	});

	const linkMutation = useMutation({
		mutationFn: (prd: PrdSearchResult) => linkVideoToPrd(videoId, prd),
		onSuccess: (_, prd) => {
			toast.success(`Linked to ${prd.name}`);
			setPickerOpen(false);
			setSearch("");
			refresh();
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : "Failed to link PRD",
			);
		},
	});

	const unlinkMutation = useMutation({
		mutationFn: (prdId: string) => unlinkVideoFromPrd(videoId, prdId),
		onSuccess: () => {
			toast.success("PRD link removed");
			refresh();
		},
		onError: (error) => {
			toast.error(
				error instanceof Error ? error.message : "Failed to remove PRD link",
			);
		},
	});

	const query = search.trim().toLowerCase();
	const linkedIds = new Set(linkedPrds.map((l) => l.prdId));
	const results = (prdsQuery.data ?? [])
		.filter((p) => !linkedIds.has(p.id))
		.filter(
			(p) =>
				!query ||
				p.name.toLowerCase().includes(query) ||
				p.slug.toLowerCase().includes(query),
		)
		.slice(0, 8);

	if (!isOwner && linkedPrds.length === 0) return null;

	return (
		<div className="flex flex-wrap gap-2 items-center">
			{linkedPrds.map((prd) => (
				<span
					key={prd.prdId}
					className="flex gap-1.5 items-center px-2.5 py-1 text-xs rounded-full border bg-gray-3 border-gray-6 text-gray-12"
				>
					<FileText className="size-3 text-gray-10" />
					<a
						href={prd.url}
						target="_blank"
						rel="noreferrer"
						className="flex gap-1 items-center hover:underline"
						title={`Open ${prd.name} in the work app`}
					>
						{prd.name}
						<ExternalLink className="size-2.5 text-gray-10" />
					</a>
					{isOwner && (
						<button
							type="button"
							aria-label={`Unlink ${prd.name}`}
							className="text-gray-10 transition-colors hover:text-red-500 disabled:opacity-50"
							disabled={unlinkMutation.isPending}
							onClick={() => unlinkMutation.mutate(prd.prdId)}
						>
							<X className="size-3" />
						</button>
					)}
				</span>
			))}
			{isOwner && (
				<div className="relative" ref={pickerRef}>
					<Button
						className="px-3 w-fit"
						size="xs"
						variant="outline"
						onClick={() => setPickerOpen((v) => !v)}
					>
						<Plus className="mr-1 size-3" />
						Link to PRD
					</Button>
					{pickerOpen && (
						<div className="absolute left-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-lg border border-gray-6 bg-white shadow-lg">
							<input
								type="text"
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								placeholder="Search PRDs…"
								className="px-3 py-2 w-full text-sm border-b outline-none border-gray-5"
							/>
							<div className="overflow-y-auto max-h-64">
								{prdsQuery.isLoading ? (
									<p className="px-3 py-2 text-sm text-gray-10">
										Loading PRDs…
									</p>
								) : prdsQuery.isError ? (
									<p className="px-3 py-2 text-sm text-red-500">
										{prdsQuery.error instanceof Error
											? prdsQuery.error.message
											: "Failed to load PRDs"}
									</p>
								) : results.length === 0 ? (
									<p className="px-3 py-2 text-sm text-gray-10">
										No matching PRDs
									</p>
								) : (
									results.map((prd) => (
										<button
											key={prd.id}
											type="button"
											className="flex flex-col px-3 py-2 w-full text-left transition-colors hover:bg-gray-3 disabled:opacity-50"
											disabled={linkMutation.isPending}
											onClick={() => linkMutation.mutate(prd)}
										>
											<span className="text-sm text-gray-12">{prd.name}</span>
											<span className="text-xs text-gray-10">{prd.slug}</span>
										</button>
									))
								)}
							</div>
							<button
								type="button"
								className="px-3 py-1.5 w-full text-xs text-left border-t border-gray-5 text-gray-10 transition-colors hover:text-gray-12"
								onClick={() =>
									queryClient.invalidateQueries({
										queryKey: ["work-app-prds"],
									})
								}
							>
								Refresh list
							</button>
						</div>
					)}
				</div>
			)}
		</div>
	);
};
