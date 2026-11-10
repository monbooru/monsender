# Contributing

See [monbooru's CONTRIBUTING](https://github.com/monbooru/monbooru/blob/main/CONTRIBUTING.md);
it covers all the monbooru repos, including this one.

Code changes come as pull requests against `dev`; `main` holds one snapshot per release and is the default branch, so check the base branch. Verify runs on every pull request: both bundles are built, the web-ext toolchain is audited and `web-ext lint` runs; it fails a pull request that targets `main`. The `dev-build` pre-release is a build of `dev` for testing, not a release.

Open issues for the browser extension here.
