# Pub Dependency Graph

A GitHub Action that submits **Dart and Flutter dependencies** to GitHub's dependency graph
through the [dependency submission API](https://docs.github.com/en/rest/dependency-graph/dependency-submission).

GitHub's built-in pub support reads `pubspec.lock` files and lists every locked package as a
dependency of the repository, with no tree and no distinction between direct and transitive
dependencies. This action submits what `pub deps --json` reports instead:

- the full dependency tree,
- `direct` / `indirect` relationships,
- `runtime` / `development` scopes,
- one manifest per package, including every package of a pub workspace.

## Usage

The action runs `pub get --enforce-lockfile` and `pub deps --json`, so set up the SDK first.

```yaml
name: Pub dependency graph
on:
  push:
    branches: [main]

permissions:
  contents: write   # required by the dependency submission API

jobs:
  submit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: subosito/flutter-action@v2   # or dart-lang/setup-dart@v1
        with:
          channel: stable
      - uses: <owner>/github-pub-dependency-graph@v1
```

Requires Dart 3.6 / Flutter 3.27 or newer and committed `pubspec.lock` files.

### Inputs

| Input | Default | Description |
|---|---|---|
| `working-directory` | `.` | Directory to search for `pubspec.lock` files. |
| `token` | `${{ github.token }}` | Token with `contents: write`. |
| `dry-run` | `false` | Only write the snapshot file, don't submit it. |

### Outputs

| Output | Description |
|---|---|
| `snapshot-path` | Path of the generated snapshot JSON. |
| `snapshot-id` | Id of the submitted snapshot. |

## What gets submitted

Every directory with a `pubspec.lock` is a project (`.dart_tool`, `build`, `.symlinks`,
`Pods`, `node_modules` and `.git` are skipped). Each project uses `flutter` if it locks the
Flutter SDK and `dart` otherwise.

- **Manifests:** the project (or workspace root) is reported under its `pubspec.lock` path,
  which replaces GitHub's flat listing of that file. Every other workspace package is reported
  under its own `pubspec.yaml` path.
- **direct:** declared in the package's `dependencies` or `dev_dependencies`.
  **indirect:** reached only through other packages.
- **runtime:** reachable from `dependencies`. **development:** reachable only from
  `dev_dependencies`.
- **Path packages** are your own code. They aren't reported, and their dependencies count as
  direct dependencies of the package that uses them.
- **Workspace packages** aren't reported in each other's manifests; each one lists its own
  dependencies.
- **SDK packages** (`flutter`, `flutter_test`, …) aren't reported, but the packages they pull
  in (e.g. `vector_math`) are, as `indirect`.
- **Package URLs** are `pkg:pub/<name>@<version>`.

On pull requests the snapshot is attributed to the head commit and branch, so
[dependency review](https://github.com/actions/dependency-review-action) can compare it.
Pull requests from forks get a read-only token and can't submit.

## Development

```bash
npm test
```

The tests use a fake `dart`/`flutter` that prints a recorded `pub deps --json` output. The CI
workflow also runs the action against a real Dart workspace.

## License

MIT
