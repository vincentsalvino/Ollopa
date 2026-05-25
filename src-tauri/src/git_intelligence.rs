use serde::Serialize;
use std::path::Path;
use std::process::Command;

/// Git repository status information
#[derive(Debug, Clone, Serialize)]
pub struct GitInfo {
    pub is_git_repo: bool,
    pub branch: String,
    pub remote_url: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub staged: u32,
    pub modified: u32,
    pub untracked: u32,
    pub recent_commits: Vec<GitCommit>,
    pub contributors: Vec<String>,
}

/// A git commit summary
#[derive(Debug, Clone, Serialize)]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

fn run_git(dir: &str, args: &[&str]) -> Option<String> {
    Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
}

/// Get comprehensive git info for a project directory.
pub fn get_git_info(project_path: &str) -> GitInfo {
    let path = Path::new(project_path);
    if !path.join(".git").exists() {
        return GitInfo {
            is_git_repo: false,
            branch: String::new(),
            remote_url: None,
            ahead: 0,
            behind: 0,
            staged: 0,
            modified: 0,
            untracked: 0,
            recent_commits: vec![],
            contributors: vec![],
        };
    }

    let branch = run_git(project_path, &["rev-parse", "--abbrev-ref", "HEAD"])
        .unwrap_or_else(|| "unknown".to_string());

    let remote_url = run_git(project_path, &["remote", "get-url", "origin"]);

    // Ahead/behind tracking branch
    let (ahead, behind) = run_git(
        project_path,
        &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
    )
    .and_then(|s| {
        let parts: Vec<&str> = s.split_whitespace().collect();
        if parts.len() == 2 {
            Some((
                parts[0].parse().unwrap_or(0),
                parts[1].parse().unwrap_or(0),
            ))
        } else {
            None
        }
    })
    .unwrap_or((0, 0));

    // Status counts
    let (staged, modified, untracked) =
        run_git(project_path, &["status", "--porcelain"])
            .map(|s| {
                let mut st = 0u32;
                let mut md = 0u32;
                let mut ut = 0u32;
                for line in s.lines() {
                    if line.len() < 2 {
                        continue;
                    }
                    let bytes = line.as_bytes();
                    if bytes[0] == b'?' {
                        ut += 1;
                    } else {
                        if bytes[0] != b' ' {
                            st += 1;
                        }
                        if bytes[1] != b' ' {
                            md += 1;
                        }
                    }
                }
                (st, md, ut)
            })
            .unwrap_or((0, 0, 0));

    // Recent commits (last 10)
    let recent_commits = run_git(
        project_path,
        &[
            "log",
            "--oneline",
            "--format=%H|%h|%s|%an|%ar",
            "-10",
        ],
    )
    .map(|s| {
        s.lines()
            .filter_map(|line| {
                let parts: Vec<&str> = line.splitn(5, '|').collect();
                if parts.len() == 5 {
                    Some(GitCommit {
                        hash: parts[0].to_string(),
                        short_hash: parts[1].to_string(),
                        message: parts[2].to_string(),
                        author: parts[3].to_string(),
                        date: parts[4].to_string(),
                    })
                } else {
                    None
                }
            })
            .collect()
    })
    .unwrap_or_default();

    // Contributors (unique authors)
    let contributors = run_git(
        project_path,
        &["log", "--format=%an", "--all"],
    )
    .map(|s| {
        let mut authors: Vec<String> = s
            .lines()
            .map(|l| l.to_string())
            .collect();
        authors.sort();
        authors.dedup();
        authors
    })
    .unwrap_or_default();

    GitInfo {
        is_git_repo: true,
        branch,
        remote_url,
        ahead,
        behind,
        staged,
        modified,
        untracked,
        recent_commits,
        contributors,
    }
}
