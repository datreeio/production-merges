#!/usr/bin/env node

const getProperty = require("lodash.get");
const program = require("commander");
const moment = require("moment");
const octokit = require("@octokit/rest")({
	headers: {
		accept: "application/vnd.github.drax-preview+json",
	},
});

program
	.usage("Get a list of repositories that need merging to production")
	.option("-t, --token <token>", "The github token")
	.option("-o, --org <org>", "The org name")
	.parse(process.argv);

async function main() {
	await octokit.authenticate({
		type: "token",
		token: program.token,
	});

	const repoResponse = await _paginate(
		octokit,
		octokit.repos.getForOrg({
			org: program.org,
			per_page: 100,
		})
	);

	const repos = repoResponse.filter(
		(repo) => moment().diff(moment(repo.updated_at), "months") < 3
	);

	const needChange = [];
	const noChange = [];
	const errors = [];

	for (const repository of repos) {
		let base, head, owner, repo;
		try {
			base = getBaseBranch(repo);
			head = "staging";
			owner = repository.owner.login;
			repo = repository.name;

			const result = await octokit.repos.compareCommits({
				owner,
				repo,
				base,
				head,
			});

			if (result.data.ahead_by > 0)
				needChange.push(
					`\n${owner}/${repo}:
          Changes in ${head} that are not in ${base}
          Create Pull Request: ${repository.html_url}/compare/${base}...${head}`
				);
			else {
				noChange.push(
					`\n${owner}/${repo}:
          No changes in ${head} that are not in ${base}`
				);
			}
		} catch (err) {
			errors.push(`\n${owner}/${repo}:
      Error comparing ${head} and ${base}.
      Maybe the ${base} or ${head} branch doesn't exist`);
		}
	}
	return { needChange, noChange, errors };
}

function getBaseBranch(repository) {
	// don't use only repository["default_branch"] because we want to make sure
	// we use 'master' || 'main' and not 'staging'.
	return repository["default_branch"] === "master" ? "master" : "main";
}

async function _paginate(client, prom, resourceKey = "data") {
	let response = await prom;
	let resourceList = getProperty(response, resourceKey);
	while (client.hasNextPage(response)) {
		response = await client.getNextPage(response);
		resourceList = resourceList.concat(getProperty(response, resourceKey));
	}
	return resourceList;
}

if (require.main === module) {
	main()
		.then((res) => {
			console.log("Repositories that have changes:\n");
			for (const result of res.needChange) console.log(result);
			console.log("\n\nRepositories that have no changes:\n");
			for (const result of res.noChange) console.log(result);
			console.log("\n\nRepositories with errors detecting changes:\n");
			for (const result of res.errors) console.log(result);
			console.log("Done");
			process.exitCode = 0;
		})
		.catch((err) => {
			console.error({ err });
			process.exitCode = 1;
		});
}
