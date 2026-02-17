Tests delete-rename-write order
<blaze-delete path="src/main.tsx">
</blaze-delete>
<blaze-rename from="src/App.tsx" to="src/main.tsx">
</blaze-rename>
<blaze-write path="src/main.tsx" description="final main.tsx file.">
finalMainTsxFileWithError();
</blaze-write>
EOM
