# GitHub Release Checklist

Use this checklist before publishing the repository or creating a tagged GitHub release.

## One-Time Repository Setup

1. Initialize Git if needed:

```bash
git init
git branch -M main
```

2. Confirm private local files are ignored:

```bash
git status --short
```

Do not commit `.env.local`, `data/*.sqlite`, generated files under `applications/`, resumes, or profile exports.

3. Create a GitHub repository and add it as `origin`:

```bash
git remote add origin git@github.com:<owner>/<repo>.git
```

4. Commit and push:

```bash
git add .
git commit -m "chore: prepare public noncommercial release"
git push -u origin main
```

## Release Steps

1. Run local verification:

```bash
npm run verify
npm run build
rm -rf .next tsconfig.tsbuildinfo
```

2. Create and push a version tag:

```bash
git tag v<version>
git push origin v<version>
```

Pushing the tag runs `.github/workflows/release.yml`, verifies the app, builds it, creates a source archive from tracked files only, and publishes a GitHub Release.

## License

This project uses the PolyForm Noncommercial License 1.0.0. Noncommercial use is allowed; commercial use requires separate written permission from the copyright holder.
