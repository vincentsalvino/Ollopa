use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use regex::Regex;
use std::io::{BufRead, BufReader, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

/// Dangerous command patterns that require user approval
const DANGEROUS_PATTERNS: &[&str] = &[
    r"rm\s+-rf",
    r"rm\s+-r",
    r"DROP\s+TABLE",
    r"DROP\s+DATABASE",
    r"DELETE\s+FROM",
    r"sudo\s+",
    r"curl\s+.*\|\s*bash",
    r"curl\s+.*\|\s*sh",
    r"wget\s+.*\|\s*bash",
    r"wget\s+.*\|\s*sh",
    r"git\s+push\s+--force",
];

// ═══════ Events emitted to the frontend ═══════

#[derive(Clone, serde::Serialize)]
pub struct PtyOutput {
    pub line: String,
    pub is_error: bool,
}

#[derive(Clone, serde::Serialize)]
pub struct ApprovalRequest {
    pub command: String,
    pub risk_label: String,
}

#[derive(Clone, serde::Serialize)]
pub struct PlanGate {
    pub lines: Vec<String>,
    pub file_count: usize,
}

#[allow(dead_code)]
#[derive(Clone, serde::Serialize)]
pub struct TokenUpdate {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost_usd: f64,
}


pub struct PtySession {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    paused: Arc<AtomicBool>,
    #[allow(dead_code)]
    dangerous_regexes: Vec<Regex>,
    #[allow(dead_code)]
    file_path_regex: Regex,
}

/// Strip ANSI escape codes from raw PTY output
fn strip_ansi(s: &str) -> String {
    // Matches CSI sequences (e.g. \x1b[31m) and OSC sequences (e.g. \x1b]0;title\x07)
    lazy_static_regex(s)
}

fn lazy_static_regex(s: &str) -> String {
    let re = Regex::new(r"\x1b\[[0-9;?]*[a-zA-Z]|\x1b\[[0-9;?]*[hl]|\x1b\][^\x07]*\x07|\x1b\(B").unwrap();
    re.replace_all(s, "").to_string()
}

impl PtySession {
    /// Spawn the claude CLI in a pty and start streaming output.
    ///
    /// Runs in interactive mode (no --output-format flag).
    /// Accepts an optional `working_dir` to set the cwd for the spawned process.
    pub fn spawn(
        app_handle: AppHandle,
        initial_message: Option<String>,
        working_dir: Option<&str>,
    ) -> Result<Self, String> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows: 40,
                cols: 120,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open pty: {}", e))?;

        #[cfg(target_os = "windows")]
        let mut cmd = {
            let mut c = CommandBuilder::new("cmd");
            c.args(["/C", "claude"]);
            c
        };

        #[cfg(not(target_os = "windows"))]
        let mut cmd = {
            let mut c = CommandBuilder::new("claude");
            c
        };

        // Inherit ANTHROPIC_* env vars from system environment (set via Windows User env vars)
        // Set TERM so Claude Code knows it's in a capable terminal
        cmd.env("TERM", "xterm-256color");

        // Remove ANTHROPIC_AUTH_TOKEN from parent process env before spawning.
        // CommandBuilder inherits the parent env, so this prevents the child from
        // seeing both AUTH_TOKEN and API_KEY (which causes an auth conflict exit).
        std::env::remove_var("ANTHROPIC_AUTH_TOKEN");

        // Set working directory if provided (project switcher)
        if let Some(dir) = working_dir {
            cmd.cwd(dir);
        }

        let _child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn claude: {}", e))?;

        drop(pair.slave);

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone reader: {}", e))?;

        let writer: Box<dyn Write + Send> = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take writer: {}", e))?;

        let writer = Arc::new(Mutex::new(writer));
        let paused = Arc::new(AtomicBool::new(false));

        let dangerous_regexes: Vec<Regex> = DANGEROUS_PATTERNS
            .iter()
            .map(|p| Regex::new(p).unwrap())
            .collect();

        let file_path_regex = Regex::new(r"(?:^|\s)([/.][\w\-./]+\.\w+)").unwrap();

        // Spawn reader thread — handles raw PTY output
        let app_clone = app_handle.clone();
        let paused_clone = paused.clone();
        let dangerous_clone = dangerous_regexes.clone();
        let file_regex_clone = file_path_regex.clone();
        let writer_clone = writer.clone();
        let initial_message_clone = initial_message.clone();

        std::thread::spawn(move || {
            let mut buf_reader = BufReader::new(reader);

            // Wait for Claude Code to be ready, auto-confirm trust, then inject memory.
            // All startup output is forwarded to the frontend for diagnostics.
            let mut trust_confirmed = false;
            let mut ready = false;
            let mut line_count = 0;

            loop {
                let mut line = String::new();
                match buf_reader.read_line(&mut line) {
                    Ok(0) => {
                        // EOF — process exited before becoming ready
                        let _ = app_clone.emit(
                            "pty-output",
                            PtyOutput {
                                line: format!(
                                    "[DEBUG] Claude exited during startup after {} lines",
                                    line_count
                                ),
                                is_error: true,
                            },
                        );
                        break;
                    }
                    Ok(_) => {
                        let trimmed = line.trim_end().to_string();
                        let clean = strip_ansi(&trimmed);
                        line_count += 1;

                        // Forward ALL startup output to the frontend (raw for diagnostics)
                        let _ = app_clone.emit(
                            "pty-output",
                            PtyOutput {
                                line: format!("[startup:{}] {}", line_count, if clean.is_empty() { &trimmed } else { &clean }),
                                is_error: false,
                            },
                        );

                        // Auto-confirm trust prompt
                        if clean.contains("Yes, I trust this folder")
                            || clean.contains("trust this folder")
                            || clean.contains("I trust this")
                        {
                            std::thread::sleep(std::time::Duration::from_millis(300));
                            let mut w = writer_clone.lock();
                            let _ = w.write_all(b"1\n");
                            let _ = w.flush();
                            trust_confirmed = true;
                            std::thread::sleep(std::time::Duration::from_millis(1000));
                            continue;
                        }

                        // Detect Claude Code ready prompt
                        let is_ready_prompt = clean.starts_with('\u{276F}')
                            || clean.starts_with("> ")
                            || clean == ">"
                            || (trust_confirmed && clean.is_empty() && line_count > 30);

                        if is_ready_prompt {
                            ready = true;
                        }

                        if ready {
                            if let Some(ref msg) = initial_message_clone {
                                std::thread::sleep(std::time::Duration::from_millis(500));
                                let mut w = writer_clone.lock();
                                let _ = w.write_all(msg.as_bytes());
                                let _ = w.write_all(b"\n");
                                let _ = w.flush();
                            }
                            break;
                        }

                        // Safety fallback — after 60 lines assume ready
                        if line_count > 60 {
                            if let Some(ref msg) = initial_message_clone {
                                std::thread::sleep(std::time::Duration::from_millis(1000));
                                let mut w = writer_clone.lock();
                                let _ = w.write_all(msg.as_bytes());
                                let _ = w.write_all(b"\n");
                                let _ = w.flush();
                            }
                            break;
                        }
                    }
                    Err(e) => {
                        let _ = app_clone.emit(
                            "pty-output",
                            PtyOutput {
                                line: format!("[DEBUG] Startup read error: {}", e),
                                is_error: true,
                            },
                        );
                        break;
                    }
                }
            }
            let mut response_files: Vec<String> = Vec::new();
            let mut response_lines: Vec<String> = Vec::new();
            let mut in_response = false;

            for line_result in buf_reader.lines() {
                match line_result {
                    Ok(line) => {
                        while paused_clone.load(Ordering::Relaxed) {
                            std::thread::sleep(std::time::Duration::from_millis(50));
                        }
                        let clean = strip_ansi(&line);
                        Self::handle_raw_line(
                            &app_clone,
                            &paused_clone,
                            &dangerous_clone,
                            &file_regex_clone,
                            &clean,
                            &mut response_files,
                            &mut response_lines,
                            &mut in_response,
                        );
                    }
                    Err(_) => break,
                }
            }

            let _ = app_clone.emit(
                "pty-output",
                PtyOutput {
                    line: "[Process exited]".to_string(),
                    is_error: true,
                },
            );
        });

        Ok(Self {
            writer,
            paused,
            dangerous_regexes,
            file_path_regex,
        })
    }

    /// Handle raw PTY output lines — fallback for startup, prompts, etc.
    fn handle_raw_line(
        app: &AppHandle,
        paused: &Arc<AtomicBool>,
        dangerous_regexes: &[Regex],
        file_regex: &Regex,
        line: &str,
        response_files: &mut Vec<String>,
        response_lines: &mut Vec<String>,
        in_response: &mut bool,
    ) {
        let _ = app.emit(
            "pty-output",
            PtyOutput {
                line: line.to_string(),
                is_error: false,
            },
        );

        if line.contains("assistant") || line.starts_with('>') {
            *in_response = true;
            response_files.clear();
            response_lines.clear();
        }

        if *in_response {
            response_lines.push(line.to_string());

            for cap in file_regex.captures_iter(line) {
                if let Some(path) = cap.get(1) {
                    let p = path.as_str().to_string();
                    if !response_files.contains(&p) {
                        response_files.push(p);
                    }
                }
            }

            if response_files.len() > 3 {
                paused.store(true, Ordering::Relaxed);
                let _ = app.emit(
                    "plan-gate",
                    PlanGate {
                        lines: response_lines.clone(),
                        file_count: response_files.len(),
                    },
                );
            }
        }

        Self::check_dangerous(app, paused, dangerous_regexes, line);

        if line.is_empty() || line.starts_with("human") || line.starts_with('$') {
            *in_response = false;
            response_files.clear();
            response_lines.clear();
        }
    }

    /// Check a text fragment for dangerous command patterns
    fn check_dangerous(
        app: &AppHandle,
        paused: &Arc<AtomicBool>,
        dangerous_regexes: &[Regex],
        text: &str,
    ) {
        for regex in dangerous_regexes {
            if regex.is_match(text) {
                paused.store(true, Ordering::Relaxed);
                let risk = if text.contains("rm") {
                    "DESTRUCTIVE: File deletion"
                } else if text.contains("DROP") || text.contains("DELETE") {
                    "DESTRUCTIVE: Database modification"
                } else if text.contains("sudo") {
                    "ELEVATED: Root privilege escalation"
                } else if text.contains("push --force") {
                    "DESTRUCTIVE: Force push to remote"
                } else {
                    "DANGEROUS: Remote code execution"
                };

                let _ = app.emit(
                    "approval-request",
                    ApprovalRequest {
                        command: text.to_string(),
                        risk_label: risk.to_string(),
                    },
                );
                break;
            }
        }
    }

    /// Write user input to the pty stdin
    pub fn write_input(&self, input: &str) -> Result<(), String> {
        let mut w = self.writer.lock();
        w.write_all(input.as_bytes())
            .map_err(|e| format!("Write failed: {}", e))?;
        w.write_all(b"\n")
            .map_err(|e| format!("Write newline failed: {}", e))?;
        w.flush().map_err(|e| format!("Flush failed: {}", e))?;
        Ok(())
    }

    /// Resume after approval (write yes/no to pty)
    pub fn respond_approval(&self, approved: bool) {
        let response = if approved { "yes\n" } else { "no\n" };
        let mut w = self.writer.lock();
        let _ = w.write_all(response.as_bytes());
        let _ = w.flush();
        self.paused.store(false, Ordering::Relaxed);
    }

    /// Resume after plan approval
    pub fn approve_plan(&self) {
        self.paused.store(false, Ordering::Relaxed);
    }

    /// Deny plan — write "no" to pty and unpause
    pub fn deny_plan(&self) {
        let mut w = self.writer.lock();
        let _ = w.write_all(b"no\n");
        let _ = w.flush();
        self.paused.store(false, Ordering::Relaxed);
    }
}
