import { getGithubUser } from "../handlers/github_handlers";

export async function getGitAuthor() {
  const user = await getGithubUser();
  const author = user
    ? {
        name: `[blaze]`,
        email: user.email,
      }
    : {
        name: "[blaze]",
        email: "git@blaze.sh",
      };
  return author;
}
