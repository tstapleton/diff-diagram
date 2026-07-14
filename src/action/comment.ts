import { readFile } from "node:fs/promises";
import * as github from "@actions/github";
import type { Graph } from "../types.js";
import { buildCommentBody, findExistingCommentId } from "./comment-body.js";

async function main(): Promise<void> {
	const token = process.env.GITHUB_TOKEN;
	const artifactUrl = process.env.ARTIFACT_URL;
	const graphJsonPath = process.env.GRAPH_JSON;
	if (!token || !artifactUrl || !graphJsonPath) {
		throw new Error("GITHUB_TOKEN, ARTIFACT_URL, and GRAPH_JSON must be set");
	}
	const pr = github.context.payload.pull_request;
	if (!pr) {
		throw new Error("This action only runs on pull_request events");
	}

	const graph: Graph = JSON.parse(await readFile(graphJsonPath, "utf8"));
	const { owner, repo } = github.context.repo;
	const runUrl = `${github.context.serverUrl}/${owner}/${repo}/actions/runs/${github.context.runId}`;
	const body = buildCommentBody(graph, {
		artifactUrl,
		runUrl,
		headSha: pr.head.sha,
	});

	const octokit = github.getOctokit(token);
	const comments = await octokit.paginate(octokit.rest.issues.listComments, {
		owner,
		repo,
		issue_number: pr.number,
		per_page: 100,
	});
	const existingId = findExistingCommentId(comments, graph.meta.scopeDir);
	if (existingId !== null) {
		await octokit.rest.issues.updateComment({
			owner,
			repo,
			comment_id: existingId,
			body,
		});
		console.log(`Updated comment ${existingId}`);
	} else {
		const created = await octokit.rest.issues.createComment({
			owner,
			repo,
			issue_number: pr.number,
			body,
		});
		console.log(`Created comment ${created.data.id}`);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
