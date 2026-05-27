use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

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
        "tauri.conf.json", "OLLOPA.md",
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
#[allow(clippy::field_reassign_with_default)]
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

// ═══════════════════════════════════════════════════════════════
// UPGRADE PHASE E — Workspace Intelligence
// Continuous repo mapping, change impact analysis,
// architectural drift detection, workflow pattern recognition
// ═══════════════════════════════════════════════════════════════

/// Module/component mapping of a repository
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoMap {
    pub project_path: String,
    pub modules: Vec<ModuleInfo>,
    pub boundaries: Vec<ArchBoundary>,
    pub hot_files: Vec<HotFile>,
    pub created_at: u64,
}

/// A module within the repository
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleInfo {
    pub name: String,
    pub path: String,
    pub file_count: usize,
    pub line_count: usize,
    pub language: String,
    pub dependencies: Vec<String>,
}

/// An architectural boundary
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchBoundary {
    pub name: String,
    pub boundary_type: String,
    pub modules: Vec<String>,
}

/// A frequently modified file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HotFile {
    pub path: String,
    pub modification_count: usize,
    pub last_modified: u64,
}

/// Change impact prediction
#[derive(Debug, Clone, Serialize)]
pub struct ChangeImpact {
    pub target_file: String,
    pub affected_files: Vec<String>,
    pub affected_modules: Vec<String>,
    pub risk_level: String,
    pub dependency_depth: usize,
    pub regression_risk: Vec<String>,
}

/// Architectural drift detection result
#[derive(Debug, Clone, Serialize)]
pub struct DriftReport {
    pub project_path: String,
    pub violations: Vec<DriftViolation>,
    pub coupling_score: f64,
    pub health_score: f64,
    pub created_at: u64,
}

/// A detected drift violation
#[derive(Debug, Clone, Serialize)]
pub struct DriftViolation {
    pub violation_type: String,
    pub description: String,
    pub severity: String,
    pub affected_files: Vec<String>,
}

/// Workflow pattern detected from session history
#[derive(Debug, Clone, Serialize)]
pub struct WorkflowPattern {
    pub pattern_type: String,
    pub description: String,
    pub frequency: usize,
    pub example_sessions: Vec<String>,
    pub files_involved: Vec<String>,
}

fn workspace_intel_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/home/ubuntu"))
        .join(".ollopa")
        .join("workspace-brain")
        .join("intelligence")
}

fn ensure_intel_dirs() {
    let _ = fs::create_dir_all(workspace_intel_dir());
}

fn current_timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Build a comprehensive repo map
pub fn build_repo_map(project_path: &str) -> RepoMap {
    ensure_intel_dirs();
    let path = Path::new(project_path);
    let mut modules: Vec<ModuleInfo> = Vec::new();

    // Scan top-level directories as modules
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            if !entry_path.is_dir() || SKIP_DIRS.contains(&name.as_str()) || name.starts_with('.') {
                continue;
            }

            let mut file_count = 0usize;
            let mut line_count = 0usize;
            let mut lang_counts: HashMap<String, usize> = HashMap::new();

            scan_module_files(&entry_path, &mut file_count, &mut line_count, &mut lang_counts, 0);

            let primary_lang = lang_counts
                .iter()
                .max_by_key(|(_, c)| *c)
                .map(|(l, _)| l.clone())
                .unwrap_or_else(|| "Unknown".to_string());

            let deps = detect_module_deps(&entry_path, &name);

            modules.push(ModuleInfo {
                name: name.clone(),
                path: entry_path.to_string_lossy().to_string(),
                file_count,
                line_count,
                language: primary_lang,
                dependencies: deps,
            });
        }
    }

    // Detect boundaries
    let boundaries = detect_boundaries(&modules);

    // Get hot files from session history
    let hot_files = compute_hot_files(project_path);

    let map = RepoMap {
        project_path: project_path.to_string(),
        modules,
        boundaries,
        hot_files,
        created_at: current_timestamp_ms(),
    };

    // Persist
    let map_path = workspace_intel_dir().join("repo_map.json");
    if let Ok(json) = serde_json::to_string_pretty(&map) {
        let _ = fs::write(map_path, json);
    }

    map
}

fn scan_module_files(
    path: &Path,
    file_count: &mut usize,
    line_count: &mut usize,
    lang_counts: &mut HashMap<String, usize>,
    depth: usize,
) {
    if depth > 6 {
        return;
    }
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let fp = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            if fp.is_dir() {
                if !SKIP_DIRS.contains(&name.as_str()) && !name.starts_with('.') {
                    scan_module_files(&fp, file_count, line_count, lang_counts, depth + 1);
                }
                continue;
            }

            *file_count += 1;
            if let Some(ext) = fp.extension().and_then(|e| e.to_str()) {
                if let Some(lang) = ext_to_lang(ext) {
                    let lines = fs::read_to_string(&fp).map(|c| c.lines().count()).unwrap_or(0);
                    *line_count += lines;
                    *lang_counts.entry(lang.to_string()).or_insert(0) += lines;
                }
            }
        }
    }
}

fn detect_module_deps(path: &Path, module_name: &str) -> Vec<String> {
    let mut deps: Vec<String> = Vec::new();

    // Scan for import statements
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let fp = entry.path();
            if !fp.is_file() {
                continue;
            }
            if let Some(ext) = fp.extension().and_then(|e| e.to_str()) {
                if matches!(ext, "ts" | "tsx" | "js" | "jsx" | "rs") {
                    if let Ok(content) = fs::read_to_string(&fp) {
                        for line in content.lines().take(50) {
                            // JS/TS imports
                            if line.contains("from '") || line.contains("from \"") {
                                if let Some(start) = line.find("from ") {
                                    let rest = &line[start + 6..];
                                    if let Some(end) = rest.find(|c: char| c == '\'' || c == '"') {
                                        let import_path = &rest[..end];
                                        if import_path.starts_with("../") || import_path.starts_with("./") {
                                            let dep = import_path
                                                .trim_start_matches("../")
                                                .trim_start_matches("./")
                                                .split('/')
                                                .next()
                                                .unwrap_or("");
                                            if !dep.is_empty() && dep != module_name && !deps.contains(&dep.to_string()) {
                                                deps.push(dep.to_string());
                                            }
                                        }
                                    }
                                }
                            }
                            // Rust use/mod
                            if line.starts_with("use crate::") || line.starts_with("mod ") {
                                let dep = line
                                    .trim_start_matches("use crate::")
                                    .trim_start_matches("mod ")
                                    .split(|c: char| c == ':' || c == ';' || c == ' ')
                                    .next()
                                    .unwrap_or("");
                                if !dep.is_empty() && dep != module_name && !deps.contains(&dep.to_string()) {
                                    deps.push(dep.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    deps
}

fn detect_boundaries(modules: &[ModuleInfo]) -> Vec<ArchBoundary> {
    let mut boundaries: Vec<ArchBoundary> = Vec::new();

    // Frontend boundary
    let frontend_modules: Vec<String> = modules
        .iter()
        .filter(|m| {
            m.language == "TypeScript" || m.language == "JavaScript"
                || m.name == "components" || m.name == "hooks" || m.name == "pages"
        })
        .map(|m| m.name.clone())
        .collect();
    if !frontend_modules.is_empty() {
        boundaries.push(ArchBoundary {
            name: "Frontend".to_string(),
            boundary_type: "layer".to_string(),
            modules: frontend_modules,
        });
    }

    // Backend boundary
    let backend_modules: Vec<String> = modules
        .iter()
        .filter(|m| {
            m.language == "Rust" || m.language == "Python" || m.language == "Go"
                || m.name == "src-tauri" || m.name == "api" || m.name == "server"
        })
        .map(|m| m.name.clone())
        .collect();
    if !backend_modules.is_empty() {
        boundaries.push(ArchBoundary {
            name: "Backend".to_string(),
            boundary_type: "layer".to_string(),
            modules: backend_modules,
        });
    }

    // Config boundary
    let config_modules: Vec<String> = modules
        .iter()
        .filter(|m| m.language == "JSON" || m.language == "YAML" || m.language == "TOML")
        .map(|m| m.name.clone())
        .collect();
    if !config_modules.is_empty() {
        boundaries.push(ArchBoundary {
            name: "Configuration".to_string(),
            boundary_type: "support".to_string(),
            modules: config_modules,
        });
    }

    boundaries
}

fn compute_hot_files(project_path: &str) -> Vec<HotFile> {
    let summaries = crate::second_brain::list_summaries(Some(project_path));
    let mut file_freq: HashMap<String, usize> = HashMap::new();

    for s in &summaries {
        for f in &s.files_touched {
            *file_freq.entry(f.clone()).or_insert(0) += 1;
        }
    }

    let mut hot: Vec<HotFile> = file_freq
        .into_iter()
        .filter(|(_, count)| *count >= 2)
        .map(|(path, count)| HotFile {
            path,
            modification_count: count,
            last_modified: current_timestamp_ms(),
        })
        .collect();

    hot.sort_by(|a, b| b.modification_count.cmp(&a.modification_count));
    hot.truncate(20);
    hot
}

/// Predict change impact for a file
pub fn predict_change_impact(project_path: &str, target_file: &str) -> ChangeImpact {
    let summaries = crate::second_brain::list_summaries(Some(project_path));

    // Find co-modified files
    let mut co_modified: HashMap<String, usize> = HashMap::new();
    for s in &summaries {
        if s.files_touched.iter().any(|f| f.contains(target_file) || target_file.contains(f)) {
            for f in &s.files_touched {
                if !f.contains(target_file) && !target_file.contains(f) {
                    *co_modified.entry(f.clone()).or_insert(0) += 1;
                }
            }
        }
    }

    let mut affected_files: Vec<String> = co_modified
        .iter()
        .filter(|(_, c)| **c >= 1)
        .map(|(f, _)| f.clone())
        .collect();
    affected_files.sort();
    affected_files.truncate(15);

    // Determine affected modules
    let map = build_repo_map(project_path);
    let affected_modules: Vec<String> = map
        .modules
        .iter()
        .filter(|m| {
            affected_files.iter().any(|f| f.contains(&m.name))
                || target_file.contains(&m.name)
        })
        .map(|m| m.name.clone())
        .collect();

    let risk_level = if affected_files.len() > 10 {
        "high".to_string()
    } else if affected_files.len() > 3 {
        "medium".to_string()
    } else {
        "low".to_string()
    };

    let mut regression_risk: Vec<String> = Vec::new();
    if affected_files.iter().any(|f| f.contains("test")) {
        regression_risk.push("Test files affected — verify test suite".to_string());
    }
    if affected_files.iter().any(|f| f.contains("config") || f.contains(".json")) {
        regression_risk.push("Config files affected — check for breaking changes".to_string());
    }

    ChangeImpact {
        target_file: target_file.to_string(),
        affected_files,
        affected_modules,
        risk_level,
        dependency_depth: co_modified.len(),
        regression_risk,
    }
}

/// Detect architectural drift
pub fn detect_drift(project_path: &str) -> DriftReport {
    let map = build_repo_map(project_path);
    let mut violations: Vec<DriftViolation> = Vec::new();

    // Check for overly coupled modules
    for module in &map.modules {
        if module.dependencies.len() > 8 {
            violations.push(DriftViolation {
                violation_type: "high_coupling".to_string(),
                description: format!(
                    "Module '{}' has {} dependencies (recommend < 8)",
                    module.name,
                    module.dependencies.len()
                ),
                severity: "warning".to_string(),
                affected_files: vec![module.path.clone()],
            });
        }
    }

    // Check for oversized modules
    for module in &map.modules {
        if module.line_count > 5000 {
            violations.push(DriftViolation {
                violation_type: "oversized_module".to_string(),
                description: format!(
                    "Module '{}' has {} lines (recommend < 5000)",
                    module.name, module.line_count
                ),
                severity: "info".to_string(),
                affected_files: vec![module.path.clone()],
            });
        }
    }

    // Check for cross-boundary dependencies
    for boundary in &map.boundaries {
        for module_name in &boundary.modules {
            if let Some(module) = map.modules.iter().find(|m| m.name == *module_name) {
                for dep in &module.dependencies {
                    let dep_boundary = map.boundaries.iter().find(|b| b.modules.contains(dep));
                    if let Some(db) = dep_boundary {
                        if db.name != boundary.name && boundary.boundary_type == "layer" && db.boundary_type == "layer" {
                            violations.push(DriftViolation {
                                violation_type: "boundary_violation".to_string(),
                                description: format!(
                                    "Module '{}' ({}) depends on '{}' ({}) — cross-boundary",
                                    module_name, boundary.name, dep, db.name
                                ),
                                severity: "warning".to_string(),
                                affected_files: vec![module.path.clone()],
                            });
                        }
                    }
                }
            }
        }
    }

    // Compute coupling score
    let total_deps: usize = map.modules.iter().map(|m| m.dependencies.len()).sum();
    let total_modules = map.modules.len().max(1);
    let coupling_score = total_deps as f64 / total_modules as f64;

    let violation_weight: f64 = violations.iter().map(|v| match v.severity.as_str() {
        "error" => 3.0,
        "warning" => 1.5,
        _ => 0.5,
    }).sum();
    let health_score = (100.0 - violation_weight * 5.0).max(0.0).min(100.0);

    DriftReport {
        project_path: project_path.to_string(),
        violations,
        coupling_score,
        health_score,
        created_at: current_timestamp_ms(),
    }
}

/// Recognize workflow patterns from session history
pub fn detect_workflow_patterns(project_path: &str) -> Vec<WorkflowPattern> {
    let summaries = crate::second_brain::list_summaries(Some(project_path));
    let mut patterns: Vec<WorkflowPattern> = Vec::new();

    // Detect debugging patterns
    let debug_sessions: Vec<&crate::second_brain::SessionSummary> = summaries
        .iter()
        .filter(|s| {
            s.tags.iter().any(|t| {
                let tl = t.to_lowercase();
                tl.contains("debug") || tl.contains("fix") || tl.contains("error")
            })
        })
        .collect();
    if debug_sessions.len() >= 2 {
        let files: Vec<String> = debug_sessions
            .iter()
            .flat_map(|s| s.files_touched.clone())
            .collect::<Vec<_>>();
        let mut deduped = files.clone();
        deduped.sort();
        deduped.dedup();

        patterns.push(WorkflowPattern {
            pattern_type: "debugging_flow".to_string(),
            description: format!("Repeated debugging across {} sessions", debug_sessions.len()),
            frequency: debug_sessions.len(),
            example_sessions: debug_sessions.iter().take(3).map(|s| s.session_id.clone()).collect(),
            files_involved: deduped.into_iter().take(10).collect(),
        });
    }

    // Detect edit patterns
    let mut file_edit_freq: HashMap<String, Vec<String>> = HashMap::new();
    for s in &summaries {
        for f in &s.files_touched {
            file_edit_freq
                .entry(f.clone())
                .or_default()
                .push(s.session_id.clone());
        }
    }
    let repeated_edits: Vec<(&String, &Vec<String>)> = file_edit_freq
        .iter()
        .filter(|(_, sessions)| sessions.len() >= 3)
        .collect();

    if !repeated_edits.is_empty() {
        patterns.push(WorkflowPattern {
            pattern_type: "repeated_edits".to_string(),
            description: format!("{} files edited across 3+ sessions", repeated_edits.len()),
            frequency: repeated_edits.len(),
            example_sessions: repeated_edits
                .iter()
                .flat_map(|(_, sessions)| sessions.iter().take(2).cloned())
                .take(5)
                .collect(),
            files_involved: repeated_edits.iter().map(|(f, _)| (*f).clone()).take(10).collect(),
        });
    }

    // Detect common tool workflows
    let mut tool_patterns: HashMap<String, usize> = HashMap::new();
    for s in &summaries {
        for action in &s.key_actions {
            let tool = action.split(':').next().unwrap_or("").trim().to_string();
            if !tool.is_empty() {
                *tool_patterns.entry(tool).or_insert(0) += 1;
            }
        }
    }
    let common_tools: Vec<(String, usize)> = tool_patterns
        .into_iter()
        .filter(|(_, count)| *count >= 5)
        .collect();

    if !common_tools.is_empty() {
        patterns.push(WorkflowPattern {
            pattern_type: "common_tools".to_string(),
            description: format!("{} tools used frequently across sessions", common_tools.len()),
            frequency: common_tools.iter().map(|(_, c)| c).sum(),
            example_sessions: summaries.iter().take(3).map(|s| s.session_id.clone()).collect(),
            files_involved: common_tools.iter().map(|(t, _)| t.clone()).collect(),
        });
    }

    patterns
}

/// Full workspace intelligence report
#[derive(Debug, Clone, Serialize)]
pub struct WorkspaceIntelligence {
    pub repo_map: RepoMap,
    pub drift_report: DriftReport,
    pub workflow_patterns: Vec<WorkflowPattern>,
    pub hot_files_count: usize,
    pub total_modules: usize,
    pub health_score: f64,
}

pub fn get_workspace_intelligence(project_path: &str) -> WorkspaceIntelligence {
    let repo_map = build_repo_map(project_path);
    let drift_report = detect_drift(project_path);
    let workflow_patterns = detect_workflow_patterns(project_path);

    WorkspaceIntelligence {
        hot_files_count: repo_map.hot_files.len(),
        total_modules: repo_map.modules.len(),
        health_score: drift_report.health_score,
        repo_map,
        drift_report,
        workflow_patterns,
    }
}
