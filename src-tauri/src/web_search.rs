use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

// ═══════ Data Structures ═══════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebSearchSettings {
    pub enabled: bool,
    pub provider: SearchProvider,
    pub max_results: usize,
    pub auto_trigger: bool,
}

impl Default for WebSearchSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            provider: SearchProvider::DuckDuckGo,
            max_results: 5,
            auto_trigger: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SearchProvider {
    DuckDuckGo,
    Tavily,
    SearXNG,
    MiMoSearch,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub title: String,
    pub url: String,
    pub snippet: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResponse {
    pub query: String,
    pub results: Vec<SearchResult>,
    pub summary: String,
    pub timestamp: u64,
}

// DuckDuckGo instant answer API response
#[derive(Debug, Deserialize)]
struct DdgResponse {
    #[serde(rename = "AbstractText")]
    abstract_text: Option<String>,
    #[serde(rename = "AbstractURL")]
    abstract_url: Option<String>,
    #[serde(rename = "AbstractSource")]
    abstract_source: Option<String>,
    #[serde(rename = "Heading")]
    heading: Option<String>,
    #[serde(rename = "RelatedTopics")]
    related_topics: Option<Vec<DdgRelatedTopic>>,
}

#[derive(Debug, Deserialize)]
struct DdgRelatedTopic {
    #[serde(rename = "Text")]
    text: Option<String>,
    #[serde(rename = "FirstURL")]
    first_url: Option<String>,
}

// ═══════ Storage ═══════

fn search_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/home/ubuntu"))
        .join(".ollopa")
        .join("workspace-brain")
        .join("search")
}

fn settings_file() -> PathBuf {
    search_dir().join("settings.json")
}

fn cache_dir() -> PathBuf {
    search_dir().join("cache")
}

fn ensure_dirs() {
    let _ = fs::create_dir_all(cache_dir());
}

fn current_timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ═══════ Search Engine ═══════

pub async fn web_search(query: &str, settings: &WebSearchSettings) -> SearchResponse {
    match settings.provider {
        SearchProvider::DuckDuckGo => search_duckduckgo(query, settings.max_results).await,
        SearchProvider::Tavily => search_tavily(query, settings.max_results).await,
        SearchProvider::SearXNG => search_searxng(query, settings.max_results).await,
        SearchProvider::MiMoSearch => search_mimo(query, settings.max_results).await,
    }
}

async fn search_duckduckgo(query: &str, max_results: usize) -> SearchResponse {
    let client = Client::new();
    let url = format!(
        "https://api.duckduckgo.com/?q={}&format=json&no_html=1&skip_disambig=1",
        urlencoding::encode(query)
    );

    let mut results = Vec::new();
    let mut summary = String::new();

    match client.get(&url)
        .header("User-Agent", "Ollopa/1.0")
        .send()
        .await
    {
        Ok(resp) => {
            if let Ok(ddg) = resp.json::<DdgResponse>().await {
                if let Some(abstract_text) = &ddg.abstract_text {
                    if !abstract_text.is_empty() {
                        summary = abstract_text.clone();
                        results.push(SearchResult {
                            title: ddg.heading.unwrap_or_else(|| query.to_string()),
                            url: ddg.abstract_url.unwrap_or_default(),
                            snippet: abstract_text.clone(),
                            source: ddg.abstract_source.unwrap_or_else(|| "DuckDuckGo".to_string()),
                        });
                    }
                }

                if let Some(topics) = ddg.related_topics {
                    for topic in topics.into_iter().take(max_results.saturating_sub(results.len())) {
                        if let (Some(text), Some(url)) = (topic.text, topic.first_url) {
                            results.push(SearchResult {
                                title: text.chars().take(100).collect(),
                                url,
                                snippet: text,
                                source: "DuckDuckGo".to_string(),
                            });
                        }
                    }
                }
            }
        }
        Err(e) => {
            summary = format!("Search failed: {}", e);
        }
    }

    if results.is_empty() {
        results.push(SearchResult {
            title: format!("Web search: {}", query),
            url: format!("https://duckduckgo.com/?q={}", urlencoding::encode(query)),
            snippet: "No instant results found. Click to search on DuckDuckGo.".to_string(),
            source: "DuckDuckGo".to_string(),
        });
    }

    let response = SearchResponse {
        query: query.to_string(),
        results,
        summary,
        timestamp: current_timestamp_ms(),
    };

    cache_search_result(&response);
    response
}

async fn search_tavily(query: &str, max_results: usize) -> SearchResponse {
    let api_key = std::env::var("TAVILY_API_KEY").unwrap_or_default();

    if api_key.is_empty() {
        return SearchResponse {
            query: query.to_string(),
            results: vec![SearchResult {
                title: "Tavily API key not configured".to_string(),
                url: "https://tavily.com".to_string(),
                snippet: "Set TAVILY_API_KEY environment variable to use Tavily search.".to_string(),
                source: "System".to_string(),
            }],
            summary: "Tavily API key not set. Falling back to DuckDuckGo.".to_string(),
            timestamp: current_timestamp_ms(),
        };
    }

    let client = Client::new();
    let body = serde_json::json!({
        "api_key": api_key,
        "query": query,
        "max_results": max_results,
        "include_answer": true,
    });

    match client.post("https://api.tavily.com/search")
        .json(&body)
        .send()
        .await
    {
        Ok(resp) => {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                let mut results = Vec::new();
                let summary = json.get("answer")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                if let Some(search_results) = json.get("results").and_then(|v| v.as_array()) {
                    for r in search_results.iter().take(max_results) {
                        results.push(SearchResult {
                            title: r.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            url: r.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            snippet: r.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            source: "Tavily".to_string(),
                        });
                    }
                }

                let response = SearchResponse {
                    query: query.to_string(),
                    results,
                    summary,
                    timestamp: current_timestamp_ms(),
                };
                cache_search_result(&response);
                return response;
            }
        }
        Err(_) => {}
    }

    search_duckduckgo(query, max_results).await
}

async fn search_searxng(query: &str, max_results: usize) -> SearchResponse {
    let base_url = std::env::var("SEARXNG_URL")
        .unwrap_or_else(|_| "https://searx.be".to_string());

    let client = Client::new();
    let url = format!(
        "{}/search?q={}&format=json&engines=duckduckgo,google,bing",
        base_url,
        urlencoding::encode(query)
    );

    match client.get(&url)
        .header("User-Agent", "Ollopa/1.0")
        .send()
        .await
    {
        Ok(resp) => {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                let mut results = Vec::new();

                if let Some(search_results) = json.get("results").and_then(|v| v.as_array()) {
                    for r in search_results.iter().take(max_results) {
                        results.push(SearchResult {
                            title: r.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            url: r.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            snippet: r.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                            source: r.get("engine").and_then(|v| v.as_str()).unwrap_or("SearXNG").to_string(),
                        });
                    }
                }

                if !results.is_empty() {
                    let response = SearchResponse {
                        query: query.to_string(),
                        results,
                        summary: String::new(),
                        timestamp: current_timestamp_ms(),
                    };
                    cache_search_result(&response);
                    return response;
                }
            }
        }
        Err(_) => {}
    }

    search_duckduckgo(query, max_results).await
}

// ═══════ MiMo Web Search (Phase 3) ═══════

async fn search_mimo(query: &str, max_results: usize) -> SearchResponse {
    let api_key = std::env::var("MIMO_API_KEY").unwrap_or_default();

    if api_key.is_empty() {
        return SearchResponse {
            query: query.to_string(),
            results: vec![SearchResult {
                title: "MiMo Search unavailable".to_string(),
                url: String::new(),
                snippet: "MIMO_API_KEY not set. Configure it in settings to use MiMo web search.".to_string(),
                source: "MiMo".to_string(),
            }],
            summary: "MiMo API key not configured".to_string(),
            timestamp: current_timestamp_ms(),
        };
    }

    let client = Client::new();

    // MiMo's chat completion API with web search enabled via tool_choice
    let body = serde_json::json!({
        "model": "mimo-v2.5-pro",
        "messages": [
            {
                "role": "system",
                "content": "You are a helpful assistant with web search capabilities. Search the web and provide accurate, sourced answers."
            },
            {
                "role": "user",
                "content": format!("Search the web for: {}", query)
            }
        ],
        "tools": [
            {
                "type": "web_search",
                "web_search": { "enable": true }
            }
        ],
        "max_tokens": 1024,
        "stream": false
    });

    match client.post("https://api.xiaomimimo.com/v1/chat/completions")
        .header("api-key", &api_key)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
    {
        Ok(resp) => {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                let content = json
                    .get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("message"))
                    .and_then(|m| m.get("content"))
                    .and_then(|c| c.as_str())
                    .unwrap_or("")
                    .to_string();

                // Parse the response into search results
                let mut results = Vec::new();
                let lines: Vec<&str> = content.lines().collect();
                let mut current_snippet = String::new();

                for line in &lines {
                    let trimmed = line.trim();
                    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
                        if !current_snippet.is_empty() {
                            results.push(SearchResult {
                                title: current_snippet.chars().take(100).collect(),
                                url: trimmed.to_string(),
                                snippet: current_snippet.clone(),
                                source: "MiMo".to_string(),
                            });
                            current_snippet.clear();
                        }
                    } else if !trimmed.is_empty() {
                        if !current_snippet.is_empty() {
                            current_snippet.push(' ');
                        }
                        current_snippet.push_str(trimmed);
                    }
                }

                // If no structured results, use the whole response as one result
                if results.is_empty() && !content.is_empty() {
                    results.push(SearchResult {
                        title: format!("MiMo search: {}", query),
                        url: String::new(),
                        snippet: content.chars().take(500).collect(),
                        source: "MiMo".to_string(),
                    });
                }

                results.truncate(max_results);

                let response = SearchResponse {
                    query: query.to_string(),
                    results,
                    summary: content.chars().take(300).collect(),
                    timestamp: current_timestamp_ms(),
                };

                cache_search_result(&response);
                return response;
            }
        }
        Err(e) => {
            return SearchResponse {
                query: query.to_string(),
                results: vec![SearchResult {
                    title: "MiMo Search error".to_string(),
                    url: String::new(),
                    snippet: format!("Search failed: {}", e),
                    source: "MiMo".to_string(),
                }],
                summary: format!("Error: {}", e),
                timestamp: current_timestamp_ms(),
            };
        }
    }

    // Fallback to DuckDuckGo
    search_duckduckgo(query, max_results).await
}

// ═══════ Formatting for LLM ═══════

pub fn format_search_for_prompt(response: &SearchResponse) -> String {
    let mut formatted = String::new();
    formatted.push_str("---\n");
    formatted.push_str(&format!("**Web Search Results for**: _{}_\n\n", response.query));

    if !response.summary.is_empty() {
        formatted.push_str(&format!("**Summary**: {}\n\n", response.summary));
    }

    for (i, result) in response.results.iter().enumerate() {
        formatted.push_str(&format!(
            "{}. **[{}]({})**\n   {}\n   _Source: {}_\n\n",
            i + 1,
            result.title,
            result.url,
            result.snippet,
            result.source,
        ));
    }

    formatted.push_str("---\n");
    formatted.push_str("*Use the above search results to inform your response. Cite sources where relevant.*\n");
    formatted
}

// ═══════ Cache ═══════

fn cache_search_result(response: &SearchResponse) {
    ensure_dirs();
    let filename = format!("{}.json", response.timestamp);
    let path = cache_dir().join(filename);
    if let Ok(json) = serde_json::to_string_pretty(response) {
        let _ = fs::write(path, json);
    }
}

pub fn list_cached_searches() -> Vec<SearchResponse> {
    let mut results = Vec::new();
    if let Ok(entries) = fs::read_dir(cache_dir()) {
        for entry in entries.flatten() {
            if let Ok(content) = fs::read_to_string(entry.path()) {
                if let Ok(response) = serde_json::from_str::<SearchResponse>(&content) {
                    results.push(response);
                }
            }
        }
    }
    results.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    results.truncate(50);
    results
}

pub fn clear_search_cache() -> usize {
    let mut count = 0;
    if let Ok(entries) = fs::read_dir(cache_dir()) {
        for entry in entries.flatten() {
            if fs::remove_file(entry.path()).is_ok() {
                count += 1;
            }
        }
    }
    count
}

// ═══════ Settings ═══════

pub fn load_settings() -> WebSearchSettings {
    fs::read_to_string(settings_file())
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default()
}

pub fn save_settings(settings: &WebSearchSettings) -> Result<(), String> {
    ensure_dirs();
    let json = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    fs::write(settings_file(), json)
        .map_err(|e| format!("Failed to write settings: {}", e))
}
