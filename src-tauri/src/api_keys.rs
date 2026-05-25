use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

// ═══════ Data Structures ═══════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKeyEntry {
    pub provider_id: String,
    pub provider_name: String,
    pub env_var: String,
    pub key_value: String,
    pub is_set: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKeyInfo {
    pub provider_id: String,
    pub provider_name: String,
    pub env_var: String,
    pub is_set: bool,
    pub masked_key: String,
}

// ═══════ Storage ═══════

fn keys_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/home/ubuntu"))
        .join(".claude")
        .join("workspace-brain")
        .join("keys")
}

fn keys_file() -> PathBuf {
    keys_dir().join("api_keys.json")
}

fn ensure_dirs() {
    let _ = fs::create_dir_all(keys_dir());
}

// ═══════ Default Provider Keys ═══════

fn default_provider_keys() -> Vec<(String, String, String)> {
    vec![
        ("deepseek".to_string(), "DeepSeek".to_string(), "DEEPSEEK_API_KEY".to_string()),
        ("claude".to_string(), "Anthropic Claude".to_string(), "ANTHROPIC_API_KEY".to_string()),
        ("openai".to_string(), "OpenAI".to_string(), "OPENAI_API_KEY".to_string()),
        ("openrouter".to_string(), "OpenRouter".to_string(), "OPENROUTER_API_KEY".to_string()),
        ("nous".to_string(), "Nous Research".to_string(), "NOUS_API_KEY".to_string()),
        ("tavily".to_string(), "Tavily (Web Search)".to_string(), "TAVILY_API_KEY".to_string()),
    ]
}

// ═══════ Key Management ═══════

/// List all provider API keys with masked values
pub fn list_api_keys() -> Vec<ApiKeyInfo> {
    let saved = load_saved_keys();
    let defaults = default_provider_keys();

    defaults
        .into_iter()
        .map(|(provider_id, provider_name, env_var)| {
            // Check saved keys first, then env var
            let saved_key = saved.iter().find(|k| k.env_var == env_var);
            let env_value = std::env::var(&env_var).ok();

            let (is_set, masked) = if let Some(sk) = saved_key {
                if !sk.key_value.is_empty() {
                    (true, mask_key(&sk.key_value))
                } else {
                    (false, String::new())
                }
            } else if let Some(ev) = env_value {
                if !ev.is_empty() {
                    (true, mask_key(&ev))
                } else {
                    (false, String::new())
                }
            } else {
                (false, String::new())
            };

            ApiKeyInfo {
                provider_id,
                provider_name,
                env_var,
                is_set,
                masked_key: masked,
            }
        })
        .collect()
}

/// Save an API key for a provider
pub fn save_api_key(env_var: &str, key_value: &str) -> Result<(), String> {
    ensure_dirs();
    let mut keys = load_saved_keys();

    // Find matching provider info
    let defaults = default_provider_keys();
    let provider_info = defaults.iter().find(|(_, _, ev)| ev == env_var);

    let (provider_id, provider_name) = match provider_info {
        Some((pid, pname, _)) => (pid.clone(), pname.clone()),
        None => (env_var.to_lowercase(), env_var.to_string()),
    };

    // Update or insert
    if let Some(existing) = keys.iter_mut().find(|k| k.env_var == env_var) {
        existing.key_value = key_value.to_string();
        existing.is_set = !key_value.is_empty();
    } else {
        keys.push(ApiKeyEntry {
            provider_id,
            provider_name,
            env_var: env_var.to_string(),
            key_value: key_value.to_string(),
            is_set: !key_value.is_empty(),
        });
    }

    // Set the env var immediately so it takes effect this session
    if !key_value.is_empty() {
        std::env::set_var(env_var, key_value);
    } else {
        std::env::remove_var(env_var);
    }

    save_keys_to_disk(&keys)
}

/// Delete an API key
pub fn delete_api_key(env_var: &str) -> Result<(), String> {
    ensure_dirs();
    let mut keys = load_saved_keys();
    keys.retain(|k| k.env_var != env_var);
    std::env::remove_var(env_var);
    save_keys_to_disk(&keys)
}

/// Load all saved keys from disk and set them as env vars
pub fn load_keys_into_env() {
    let keys = load_saved_keys();
    for key in &keys {
        if key.is_set && !key.key_value.is_empty() {
            std::env::set_var(&key.env_var, &key.key_value);
        }
    }
}

// ═══════ Internal Helpers ═══════

fn load_saved_keys() -> Vec<ApiKeyEntry> {
    fs::read_to_string(keys_file())
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

fn save_keys_to_disk(keys: &[ApiKeyEntry]) -> Result<(), String> {
    ensure_dirs();
    let json = serde_json::to_string_pretty(keys)
        .map_err(|e| format!("Failed to serialize keys: {}", e))?;
    fs::write(keys_file(), json)
        .map_err(|e| format!("Failed to write keys: {}", e))
}

fn mask_key(key: &str) -> String {
    if key.len() <= 8 {
        "*".repeat(key.len())
    } else {
        let prefix = &key[..4];
        let suffix = &key[key.len() - 4..];
        format!("{}{}{}",prefix, "*".repeat(key.len() - 8), suffix)
    }
}
