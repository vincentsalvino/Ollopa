use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

/// Comprehensive repository analysis
#[derive(Debug, Clone, Serialize)]
pub struct RepoAnalysis {
    pub languages: Vec<LanguageInfo>,
    pub frameworks: Vec<String>,
    pub package_managers: Vec<String>,
    pub total_files: usize,
    pub total_lines: usize,
    pub has_tests: bool,
    pub has_ci: bool,
    pub has_docker: bool,
    pub has_readme: bool,
    pub has_license: bool,
    pub config_files: Vec<String>,
    pub entry_points: Vec<String>,
}

/// Language usage statistics
#[derive(Debug, Clone, Serialize)]
pub struct LanguageInfo {
    pub name: String,
    pub file_count: usize,
    pub line_count: usize,
    pub percentage: f64,
}

/// Known file extension to language mappings
fn ext_to_lang(ext: &str) -> Option<&'static str> {
    match ext {
        "rs" => Some("Rust"),
        "ts" | "tsx" => Some("TypeScript"),
        "js" | "jsx" => Some("JavaScript"),
        "py" => Some("Python"),
        "go" => Some("Go"),
        "java" => Some("Java"),
        "c" | "h" => Some("C"),
        "cpp" | "cxx" | "cc" | "hpp" => Some("C++"),
        "cs" => Some("C#"),
        "rb" => Some("Ruby"),
        "php" => Some("PHP"),
        "swift" => Some("Swift"),
        "kt" | "kts" => Some("Kotlin"),
        "scala" => Some("Scala"),
        "html" | "htm" => Some("HTML"),
        "css" | "scss" | "sass" | "less" => Some("CSS"),
        "json" => Some("JSON"),
        "yaml" | "yml" => Some("YAML"),
        "toml" => Some("TOML"),
        "md" | "markdown" => Some("Markdown"),
        "sql" => Some("SQL"),
        "sh" | "bash" => Some("Shell"),
        "ps1" => Some("PowerShell"),
        "lua" => Some("Lua"),
        "zig" => Some("Zig"),
        "vue" => Some("Vue"),
        "svelte" => Some("Svelte"),
        "dart" => Some("Dart"),
        "ex" | "exs" => Some("Elixir"),
        _ => None,
    }
}

fn detect_frameworks(path: &Path) -> Vec<String> {
    let mut frameworks = Vec::new();

    // Check package.json for JS/TS frameworks
    if let Ok(content) = fs::read_to_string(path.join("package.json")) {
        let mut check = |name: &str, fw: &str| {
            if content.contains(name) {
                frameworks.push(fw.to_string());
            }
        };
        check("\"react\"", "React");
        check("\"next\"", "Next.js");
        check("\"vue\"", "Vue");
        check("\"nuxt\"", "Nuxt");
        check("\"svelte\"", "Svelte");
        check("\"angular\"", "Angular");
        check("\"express\"", "Express");
        check("\"fastify\"", "Fastify");
        check("\"tauri\"", "Tauri");
        check("\"electron\"", "Electron");
        check("\"vite\"", "Vite");
        check("\"webpack\"", "Webpack");
        check("\"tailwindcss\"", "Tailwind CSS");
    }

    // Check Cargo.toml for Rust frameworks
    if let Ok(content) = fs::read_to_string(path.join("Cargo.toml"))
        .or_else(|_| fs::read_to_string(path.join("src-tauri/Cargo.toml")))
    {
        let mut check = |name: &str, fw: &str| {
            if content.contains(name) {
                frameworks.push(fw.to_string());
            }
        };
        check("tauri", "Tauri");
        check("actix", "Actix");
        check("axum", "Axum");
        check("rocket", "Rocket");
        check("tokio", "Tokio");
        check("serde", "Serde");
    }

    // Check Python frameworks
    if let Ok(content) = fs::read_to_string(path.join("requirements.txt"))
        .or_else(|_| fs::read_to_string(path.join("pyproject.toml")))
    {
        let mut check = |name: &str, fw: &str| {
            if content.contains(name) {
                frameworks.push(fw.to_string());
            }
        };
        check("django", "Django");
        check("flask", "Flask");
        check("fastapi", "FastAPI");
        check("pytorch", "PyTorch");
        check("tensorflow", "TensorFlow");
    }

    frameworks.sort();
    frameworks.dedup();
    frameworks
}

fn detect_package_managers(path: &Path) -> Vec<String> {
    let mut managers = Vec::new();
    let checks: &[(&str, &str)] = &[
        ("package-lock.json", "npm"),
        ("yarn.lock", "Yarn"),
        ("pnpm-lock.yaml", "pnpm"),
        ("bun.lockb", "Bun"),
        ("Cargo.lock", "Cargo"),
        ("Cargo.toml", "Cargo"),
        ("go.sum", "Go Modules"),
        ("Pipfile.lock", "Pipenv"),
        ("poetry.lock", "Poetry"),
        ("requirements.txt", "pip"),
        ("Gemfile.lock", "Bundler"),
        ("composer.lock", "Composer"),
    ];
    for (file, name) in checks {
        if path.join(file).exists() || path.join("src-tauri").join(file).exists() {
            managers.push(name.to_string());
        }
    }
    managers.sort();
    managers.dedup();
    managers
}

fn detect_config_files(path: &Path) -> Vec<String> {
    let candidates = [
        "tsconfig.json", "vite.config.ts", "vite.config.js",
        "webpack.config.js", "tailwind.config.js", "tailwind.config.ts",
        "postcss.config.js", ".eslintrc.json", ".eslintrc.js",
        ".prettierrc", "jest.config.js", "vitest.config.ts",
        "Cargo.toml", "Makefile", "Dockerfile",
        "docker-compose.yml", "docker-compose.yaml",
        ".env", ".env.example", ".gitignore",
        "tauri.conf.json", "CLAUDE.md",
    ];
    candidates
        .iter()
        .filter(|f| {
            path.join(f).exists()
                || path.join("src-tauri").join(f).exists()
        })
        .map(|f| f.to_string())
        .collect()
}

fn detect_entry_points(path: &Path) -> Vec<String> {
    let candidates = [
        "src/main.tsx", "src/main.ts", "src/main.js",
        "src/index.tsx", "src/index.ts", "src/index.js",
        "src/App.tsx", "src/App.ts",
        "src-tauri/src/main.rs", "src-tauri/src/lib.rs",
        "src/main.rs", "src/lib.rs",
        "main.py", "app.py", "manage.py",
        "main.go", "cmd/main.go",
        "index.html",
    ];
    candidates
        .iter()
        .filter(|f| path.join(f).exists())
        .map(|f| f.to_string())
        .collect()
}

const SKIP_DIRS: &[&str] = &[
    "node_modules", "target", "dist", "build", ".git",
    "__pycache__", ".next", ".nuxt", "vendor", ".cargo",
    "coverage", ".turbo", ".vercel",
];

fn scan_files(path: &Path, lang_counts: &mut HashMap<String, (usize, usize)>, total: &mut usize, depth: usize) {
    if depth > 8 {
        return;
    }
    let entries = match fs::read_dir(path) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let file_path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if file_path.is_dir() {
            if !SKIP_DIRS.contains(&name.as_str()) && !name.starts_with('.') {
                scan_files(&file_path, lang_counts, total, depth + 1);
            }
            continue;
        }

        *total += 1;
        if let Some(ext) = file_path.extension().and_then(|e| e.to_str()) {
            if let Some(lang) = ext_to_lang(ext) {
                let lines = fs::read_to_string(&file_path)
                    .map(|c| c.lines().count())
                    .unwrap_or(0);
                let entry = lang_counts
                    .entry(lang.to_string())
                    .or_insert((0, 0));
                entry.0 += 1;
                entry.1 += lines;
            }
        }
    }
}

/// Analyze a repository/project directory.
pub fn analyze_repo(project_path: &str) -> RepoAnalysis {
    let path = Path::new(project_path);

    let mut lang_counts: HashMap<String, (usize, usize)> = HashMap::new();
    let mut total_files = 0usize;
    scan_files(path, &mut lang_counts, &mut total_files, 0);

    let total_lines: usize = lang_counts.values().map(|(_, l)| l).sum();

    let mut languages: Vec<LanguageInfo> = lang_counts
        .into_iter()
        .map(|(name, (fc, lc))| LanguageInfo {
            name,
            file_count: fc,
            line_count: lc,
            percentage: if total_lines > 0 {
                (lc as f64 / total_lines as f64) * 100.0
            } else {
                0.0
            },
        })
        .collect();
    languages.sort_by(|a, b| b.line_count.cmp(&a.line_count));

    let frameworks = detect_frameworks(path);
    let package_managers = detect_package_managers(path);
    let config_files = detect_config_files(path);
    let entry_points = detect_entry_points(path);

    let has_tests = path.join("tests").exists()
        || path.join("test").exists()
        || path.join("__tests__").exists()
        || path.join("src-tauri/tests").exists();
    let has_ci = path.join(".github/workflows").exists()
        || path.join(".gitlab-ci.yml").exists()
        || path.join(".circleci").exists();
    let has_docker = path.join("Dockerfile").exists()
        || path.join("docker-compose.yml").exists();
    let has_readme = path.join("README.md").exists()
        || path.join("readme.md").exists();
    let has_license = path.join("LICENSE").exists()
        || path.join("LICENSE.md").exists();

    RepoAnalysis {
        languages,
        frameworks,
        package_managers,
        total_files,
        total_lines,
        has_tests,
        has_ci,
        has_docker,
        has_readme,
        has_license,
        config_files,
        entry_points,
    }
}
