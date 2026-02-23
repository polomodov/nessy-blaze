export async function getGitAuthor() {
  return {
    name: "[blaze]",
    email: process.env.BLAZE_GIT_AUTHOR_EMAIL || "git@blaze.sh",
  };
}
