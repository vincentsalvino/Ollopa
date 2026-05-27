use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

// ═══════ Graph Node / Edge Primitives ═══════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    pub node_type: String,
    pub metadata: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
    pub label: String,
    pub edge_type: String,
    pub weight: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Graph {
    pub id: String,
    pub title: String,
    pub graph_type: String,
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub created_at: u64,
    pub project_path: Option<String>,
}

// ═══════ Session Timeline Entry ═══════

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineEvent {
    pub id: String,
    pub session_id: String,
    pub timestamp: u64,
    pub event_type: String,
    pub label: String,
    pub detail: String,
    pub duration_ms: Option<u64>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionTimelineData {
    pub session_id: String,
    pub title: String,
    pub events: Vec<TimelineEvent>,
    pub total_duration_ms: u64,
    pub created_at: u64,
}

// ═══════ Storage Paths ═══════

fn visual_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("/home/ubuntu"))
        .join(".ollopa")
        .join("workspace-brain")
        .join("visual")
}

fn graphs_dir() -> PathBuf {
    visual_dir().join("graphs")
}

fn timelines_dir() -> PathBuf {
    visual_dir().join("timelines")
}

fn ensure_dirs() {
    let _ = fs::create_dir_all(graphs_dir());
    let _ = fs::create_dir_all(timelines_dir());
}

fn current_timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ═══════ Graph CRUD ═══════

pub fn save_graph(graph: &Graph) -> Result<(), String> {
    ensure_dirs();
    let path = graphs_dir().join(format!("{}.json", graph.id));
    let json = serde_json::to_string_pretty(graph)
        .map_err(|e| format!("Failed to serialize graph: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write graph: {}", e))
}

pub fn list_graphs(project_path: Option<&str>, graph_type: Option<&str>) -> Vec<Graph> {
    ensure_dirs();
    let mut graphs: Vec<Graph> = fs::read_dir(graphs_dir())
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let content = fs::read_to_string(e.path()).ok()?;
            serde_json::from_str(&content).ok()
        })
        .collect();

    if let Some(pp) = project_path {
        graphs.retain(|g| g.project_path.as_deref() == Some(pp));
    }
    if let Some(gt) = graph_type {
        graphs.retain(|g| g.graph_type == gt);
    }

    graphs.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    graphs
}

#[allow(dead_code)]
pub fn get_graph(graph_id: &str) -> Result<Graph, String> {
    let path = graphs_dir().join(format!("{}.json", graph_id));
    let content =
        fs::read_to_string(&path).map_err(|e| format!("Graph not found: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse graph: {}", e))
}

pub fn delete_graph(graph_id: &str) -> Result<(), String> {
    let path = graphs_dir().join(format!("{}.json", graph_id));
    fs::remove_file(&path).map_err(|e| format!("Failed to delete graph: {}", e))
}

// ═══════ Timeline CRUD ═══════

#[allow(dead_code)]
pub fn save_timeline(timeline: &SessionTimelineData) -> Result<(), String> {
    ensure_dirs();
    let path = timelines_dir().join(format!("{}.json", timeline.session_id));
    let json = serde_json::to_string_pretty(timeline)
        .map_err(|e| format!("Failed to serialize timeline: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write timeline: {}", e))
}

pub fn list_timelines() -> Vec<SessionTimelineData> {
    ensure_dirs();
    let mut timelines: Vec<SessionTimelineData> = fs::read_dir(timelines_dir())
        .ok()
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let content = fs::read_to_string(e.path()).ok()?;
            serde_json::from_str(&content).ok()
        })
        .collect();

    timelines.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    timelines
}

#[allow(dead_code)]
pub fn delete_timeline(session_id: &str) -> Result<(), String> {
    let path = timelines_dir().join(format!("{}.json", session_id));
    fs::remove_file(&path).map_err(|e| format!("Failed to delete timeline: {}", e))
}

// ═══════ Auto-Generation from Brain Data ═══════

/// Build a relationship graph from session summaries and decisions
pub fn build_relationship_graph(project_path: Option<&str>) -> Graph {
    let summaries = crate::second_brain::list_summaries(project_path);
    let decisions = crate::second_brain::list_decisions(project_path);

    let mut nodes: Vec<GraphNode> = Vec::new();
    let mut edges: Vec<GraphEdge> = Vec::new();
    let mut file_set: HashMap<String, String> = HashMap::new();
    let mut tag_set: HashMap<String, String> = HashMap::new();

    // Create nodes for summaries
    for s in &summaries {
        let node_id = format!("sess-{}", s.session_id);
        nodes.push(GraphNode {
            id: node_id.clone(),
            label: truncate(&s.title, 50),
            node_type: "session".to_string(),
            metadata: {
                let mut m = HashMap::new();
                m.insert("session_id".to_string(), s.session_id.clone());
                m.insert("token_count".to_string(), s.token_count.to_string());
                m
            },
        });

        // File nodes and edges
        for f in &s.files_touched {
            let next_id = file_set.len();
            let file_id = file_set
                .entry(f.clone())
                .or_insert_with(|| format!("file-{}", next_id))
                .clone();
            edges.push(GraphEdge {
                source: node_id.clone(),
                target: file_id,
                label: "touches".to_string(),
                edge_type: "file_touch".to_string(),
                weight: 1.0,
            });
        }

        // Tag nodes and edges
        for t in &s.tags {
            let next_id = tag_set.len();
            let tag_id = tag_set
                .entry(t.clone())
                .or_insert_with(|| format!("tag-{}", next_id))
                .clone();
            edges.push(GraphEdge {
                source: node_id.clone(),
                target: tag_id,
                label: "tagged".to_string(),
                edge_type: "tag".to_string(),
                weight: 0.5,
            });
        }
    }

    // Create nodes for decisions
    for d in &decisions {
        let node_id = format!("dec-{}", d.id);
        nodes.push(GraphNode {
            id: node_id.clone(),
            label: truncate(&d.title, 50),
            node_type: "decision".to_string(),
            metadata: {
                let mut m = HashMap::new();
                m.insert("status".to_string(), format!("{:?}", d.status));
                m
            },
        });

        for t in &d.tags {
            let next_id = tag_set.len();
            let tag_id = tag_set
                .entry(t.clone())
                .or_insert_with(|| format!("tag-{}", next_id))
                .clone();
            edges.push(GraphEdge {
                source: node_id.clone(),
                target: tag_id,
                label: "tagged".to_string(),
                edge_type: "tag".to_string(),
                weight: 0.5,
            });
        }
    }

    // Add file nodes
    for (name, id) in &file_set {
        nodes.push(GraphNode {
            id: id.clone(),
            label: short_filename(name),
            node_type: "file".to_string(),
            metadata: {
                let mut m = HashMap::new();
                m.insert("path".to_string(), name.clone());
                m
            },
        });
    }

    // Add tag nodes
    for (name, id) in &tag_set {
        nodes.push(GraphNode {
            id: id.clone(),
            label: name.clone(),
            node_type: "tag".to_string(),
            metadata: HashMap::new(),
        });
    }

    Graph {
        id: format!("rel-{}", current_timestamp_ms()),
        title: "Relationship Graph".to_string(),
        graph_type: "relationship".to_string(),
        nodes,
        edges,
        created_at: current_timestamp_ms(),
        project_path: project_path.map(|s| s.to_string()),
    }
}

/// Build an architecture graph from decisions and file structure
pub fn build_architecture_graph(project_path: Option<&str>) -> Graph {
    let decisions = crate::second_brain::list_decisions(project_path);
    let summaries = crate::second_brain::list_summaries(project_path);

    let mut nodes: Vec<GraphNode> = Vec::new();
    let mut edges: Vec<GraphEdge> = Vec::new();
    let mut component_map: HashMap<String, String> = HashMap::new();

    // Extract components from file paths in summaries
    for s in &summaries {
        for f in &s.files_touched {
            let component = extract_component(f);
            let next_id = component_map.len();
            let comp_id = component_map
                .entry(component.clone())
                .or_insert_with(|| {
                    let id = format!("comp-{}", next_id);
                    nodes.push(GraphNode {
                        id: id.clone(),
                        label: component.clone(),
                        node_type: "component".to_string(),
                        metadata: HashMap::new(),
                    });
                    id
                })
                .clone();

            // Link files to their component
            let file_label = short_filename(f);
            let file_id = format!("afile-{}", nodes.len());
            nodes.push(GraphNode {
                id: file_id.clone(),
                label: file_label,
                node_type: "file".to_string(),
                metadata: {
                    let mut m = HashMap::new();
                    m.insert("path".to_string(), f.clone());
                    m
                },
            });
            edges.push(GraphEdge {
                source: comp_id,
                target: file_id,
                label: "contains".to_string(),
                edge_type: "contains".to_string(),
                weight: 1.0,
            });
        }
    }

    // Add decisions as architectural elements
    for d in &decisions {
        let dec_id = format!("adec-{}", d.id);
        nodes.push(GraphNode {
            id: dec_id.clone(),
            label: truncate(&d.title, 40),
            node_type: "decision".to_string(),
            metadata: {
                let mut m = HashMap::new();
                m.insert("status".to_string(), format!("{:?}", d.status));
                m.insert("context".to_string(), truncate(&d.context, 100));
                m
            },
        });

        // Link decisions to related components via tags
        for t in &d.tags {
            let tag_lower = t.to_lowercase();
            for (comp_name, comp_id) in &component_map {
                if comp_name.to_lowercase().contains(&tag_lower)
                    || tag_lower.contains(&comp_name.to_lowercase())
                {
                    edges.push(GraphEdge {
                        source: dec_id.clone(),
                        target: comp_id.clone(),
                        label: "affects".to_string(),
                        edge_type: "decision_impact".to_string(),
                        weight: 0.8,
                    });
                }
            }
        }
    }

    Graph {
        id: format!("arch-{}", current_timestamp_ms()),
        title: "Architecture Graph".to_string(),
        graph_type: "architecture".to_string(),
        nodes,
        edges,
        created_at: current_timestamp_ms(),
        project_path: project_path.map(|s| s.to_string()),
    }
}

/// Build a workflow DAG from session events
pub fn build_workflow_dag(project_path: Option<&str>) -> Graph {
    let summaries = crate::second_brain::list_summaries(project_path);

    let mut nodes: Vec<GraphNode> = Vec::new();
    let mut edges: Vec<GraphEdge> = Vec::new();

    for s in summaries.iter().take(20) {
        let session_node = format!("wf-sess-{}", s.session_id);
        nodes.push(GraphNode {
            id: session_node.clone(),
            label: truncate(&s.title, 40),
            node_type: "session".to_string(),
            metadata: {
                let mut m = HashMap::new();
                m.insert("token_count".to_string(), s.token_count.to_string());
                m
            },
        });

        // Create step nodes from key_actions
        let mut prev_step_id: Option<String> = Some(session_node.clone());
        for (i, action) in s.key_actions.iter().take(10).enumerate() {
            let step_id = format!("wf-step-{}-{}", s.session_id, i);
            let (tool_name, detail) = split_action(action);
            nodes.push(GraphNode {
                id: step_id.clone(),
                label: tool_name.clone(),
                node_type: "step".to_string(),
                metadata: {
                    let mut m = HashMap::new();
                    m.insert("detail".to_string(), detail);
                    m.insert("order".to_string(), i.to_string());
                    m
                },
            });

            if let Some(prev) = &prev_step_id {
                edges.push(GraphEdge {
                    source: prev.clone(),
                    target: step_id.clone(),
                    label: "then".to_string(),
                    edge_type: "sequence".to_string(),
                    weight: 1.0,
                });
            }
            prev_step_id = Some(step_id);
        }
    }

    Graph {
        id: format!("wf-{}", current_timestamp_ms()),
        title: "Workflow DAG".to_string(),
        graph_type: "workflow".to_string(),
        nodes,
        edges,
        created_at: current_timestamp_ms(),
        project_path: project_path.map(|s| s.to_string()),
    }
}

/// Build a dependency visualization from file relationships
pub fn build_dependency_graph(project_path: Option<&str>) -> Graph {
    let summaries = crate::second_brain::list_summaries(project_path);

    let mut nodes: Vec<GraphNode> = Vec::new();
    let mut edges: Vec<GraphEdge> = Vec::new();
    let mut file_nodes: HashMap<String, String> = HashMap::new();

    // Track which sessions touch which files — files co-touched in a session are related
    let mut session_files: Vec<Vec<String>> = Vec::new();

    for s in &summaries {
        let mut files_in_session: Vec<String> = Vec::new();
        for f in &s.files_touched {
            let next_id = file_nodes.len();
            let file_id = file_nodes
                .entry(f.clone())
                .or_insert_with(|| {
                    let id = format!("dep-{}", next_id);
                    let ext = f.rsplit('.').next().unwrap_or("").to_string();
                    nodes.push(GraphNode {
                        id: id.clone(),
                        label: short_filename(f),
                        node_type: ext_to_type(&ext),
                        metadata: {
                            let mut m = HashMap::new();
                            m.insert("path".to_string(), f.clone());
                            m.insert("ext".to_string(), ext);
                            m
                        },
                    });
                    id
                })
                .clone();
            files_in_session.push(file_id);
        }
        session_files.push(files_in_session);
    }

    // Create co-dependency edges (files modified in same session)
    let mut edge_set: HashMap<(String, String), u32> = HashMap::new();
    for files in &session_files {
        for i in 0..files.len() {
            for j in (i + 1)..files.len() {
                let key = if files[i] < files[j] {
                    (files[i].clone(), files[j].clone())
                } else {
                    (files[j].clone(), files[i].clone())
                };
                *edge_set.entry(key).or_insert(0) += 1;
            }
        }
    }

    for ((src, tgt), count) in &edge_set {
        edges.push(GraphEdge {
            source: src.clone(),
            target: tgt.clone(),
            label: format!("co-modified {}x", count),
            edge_type: "co_dependency".to_string(),
            weight: *count as f64,
        });
    }

    Graph {
        id: format!("dep-{}", current_timestamp_ms()),
        title: "Dependency Graph".to_string(),
        graph_type: "dependency".to_string(),
        nodes,
        edges,
        created_at: current_timestamp_ms(),
        project_path: project_path.map(|s| s.to_string()),
    }
}

/// Build a session timeline from persisted events
pub fn build_session_timeline(session_id: &str) -> Result<SessionTimelineData, String> {
    let snapshot = crate::session_manager::get_session_snapshot(session_id)?;
    let mut events: Vec<TimelineEvent> = Vec::new();
    let mut counter = 0u32;

    for pe in &snapshot.events {
        counter += 1;
        let evt = &pe.event;
        let ts = pe.timestamp_ms;

        match evt {
            crate::ollopa_events::AppEvent::SessionStarted { session_id, model, cwd, .. } => {
                events.push(TimelineEvent {
                    id: format!("tl-{}", counter),
                    session_id: session_id.clone(),
                    timestamp: ts,
                    event_type: "session_start".to_string(),
                    label: format!("Session started ({})", model),
                    detail: cwd.clone(),
                    duration_ms: None,
                    status: "success".to_string(),
                });
            }
            crate::ollopa_events::AppEvent::AssistantMessage { text, model } => {
                events.push(TimelineEvent {
                    id: format!("tl-{}", counter),
                    session_id: session_id.to_string(),
                    timestamp: ts,
                    event_type: "assistant_message".to_string(),
                    label: truncate(text, 60),
                    detail: model.clone(),
                    duration_ms: None,
                    status: "success".to_string(),
                });
            }
            crate::ollopa_events::AppEvent::ToolStarted { tool_use_id, tool_name, .. } => {
                events.push(TimelineEvent {
                    id: format!("tl-{}", counter),
                    session_id: session_id.to_string(),
                    timestamp: ts,
                    event_type: "tool_start".to_string(),
                    label: format!("Tool: {}", tool_name),
                    detail: tool_use_id.clone(),
                    duration_ms: None,
                    status: "running".to_string(),
                });
            }
            crate::ollopa_events::AppEvent::ToolFinished { tool_use_id, tool_name, is_error, .. } => {
                // Find matching start to compute duration
                let start_ts = events.iter()
                    .rfind(|e| e.event_type == "tool_start" && e.detail == *tool_use_id)
                    .map(|e| e.timestamp);
                let duration = start_ts.map(|st| ts.saturating_sub(st));

                events.push(TimelineEvent {
                    id: format!("tl-{}", counter),
                    session_id: session_id.to_string(),
                    timestamp: ts,
                    event_type: "tool_finish".to_string(),
                    label: format!("Tool done: {}", tool_name),
                    detail: tool_use_id.clone(),
                    duration_ms: duration,
                    status: if *is_error { "error".to_string() } else { "success".to_string() },
                });
            }
            crate::ollopa_events::AppEvent::SessionFinished { duration_ms, is_error, .. } => {
                events.push(TimelineEvent {
                    id: format!("tl-{}", counter),
                    session_id: session_id.to_string(),
                    timestamp: ts,
                    event_type: "session_end".to_string(),
                    label: "Session finished".to_string(),
                    detail: format!("{}ms", duration_ms),
                    duration_ms: Some(*duration_ms),
                    status: if *is_error { "error".to_string() } else { "success".to_string() },
                });
            }
            crate::ollopa_events::AppEvent::Error { message, .. } => {
                events.push(TimelineEvent {
                    id: format!("tl-{}", counter),
                    session_id: session_id.to_string(),
                    timestamp: ts,
                    event_type: "error".to_string(),
                    label: truncate(message, 60),
                    detail: message.clone(),
                    duration_ms: None,
                    status: "error".to_string(),
                });
            }
            _ => {}
        }
    }

    let total_duration = snapshot.duration_ms;
    let title = events
        .first()
        .map(|e| e.label.clone())
        .unwrap_or_else(|| "Session Timeline".to_string());

    Ok(SessionTimelineData {
        session_id: session_id.to_string(),
        title,
        events,
        total_duration_ms: total_duration,
        created_at: snapshot.created_at,
    })
}

/// Get visual memory stats
#[derive(Debug, Clone, Serialize)]
pub struct VisualStats {
    pub total_graphs: usize,
    pub total_timelines: usize,
    pub graph_types: HashMap<String, usize>,
}

pub fn get_visual_stats() -> VisualStats {
    let graphs = list_graphs(None, None);
    let timelines = list_timelines();

    let mut graph_types: HashMap<String, usize> = HashMap::new();
    for g in &graphs {
        *graph_types.entry(g.graph_type.clone()).or_insert(0) += 1;
    }

    VisualStats {
        total_graphs: graphs.len(),
        total_timelines: timelines.len(),
        graph_types,
    }
}

// ═══════ Helpers ═══════

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max.min(s.len())])
    }
}

fn short_filename(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

fn extract_component(file_path: &str) -> String {
    let parts: Vec<&str> = file_path.split('/').collect();
    if parts.len() >= 2 {
        // Use the second-to-last directory as component
        parts[parts.len().saturating_sub(2)].to_string()
    } else {
        "root".to_string()
    }
}

fn ext_to_type(ext: &str) -> String {
    match ext {
        "rs" => "rust".to_string(),
        "ts" | "tsx" => "typescript".to_string(),
        "js" | "jsx" => "javascript".to_string(),
        "css" => "style".to_string(),
        "json" | "toml" | "yaml" | "yml" => "config".to_string(),
        "md" | "txt" => "doc".to_string(),
        _ => "file".to_string(),
    }
}

fn split_action(action: &str) -> (String, String) {
    if let Some(pos) = action.find(':') {
        let tool = action[..pos].trim().to_string();
        let detail = action[pos + 1..].trim().to_string();
        (tool, detail)
    } else {
        (action.to_string(), String::new())
    }
}

// ═══════════════════════════════════════════════════════════════
// UPGRADE PHASE B — Visual Intelligence Systems
// Memory graphs, enhanced architecture, lazy expansion
// ═══════════════════════════════════════════════════════════════

/// Build a memory graph showing linked concepts, recurring patterns, and clusters
pub fn build_memory_graph(project_path: Option<&str>) -> Graph {
    let summaries = crate::second_brain::list_summaries(project_path);
    let decisions = crate::second_brain::list_decisions(project_path);

    let mut nodes: Vec<GraphNode> = Vec::new();
    let mut edges: Vec<GraphEdge> = Vec::new();
    let mut concept_map: HashMap<String, String> = HashMap::new();

    // Extract concepts from tags across all summaries and decisions
    let mut tag_freq: HashMap<String, usize> = HashMap::new();
    for s in &summaries {
        for t in &s.tags {
            *tag_freq.entry(t.clone()).or_insert(0) += 1;
        }
    }
    for d in &decisions {
        for t in &d.tags {
            *tag_freq.entry(t.clone()).or_insert(0) += 1;
        }
    }

    // Create concept nodes for recurring tags (>= 2 occurrences)
    for (tag, freq) in &tag_freq {
        if *freq >= 2 {
            let node_id = format!("concept-{}", concept_map.len());
            concept_map.insert(tag.clone(), node_id.clone());
            nodes.push(GraphNode {
                id: node_id,
                label: tag.clone(),
                node_type: "concept".to_string(),
                metadata: {
                    let mut m = HashMap::new();
                    m.insert("frequency".to_string(), freq.to_string());
                    m.insert("type".to_string(), "recurring_pattern".to_string());
                    m
                },
            });
        }
    }

    // Build co-occurrence edges between concepts
    let all_tag_sets: Vec<Vec<String>> = summaries
        .iter()
        .map(|s| s.tags.clone())
        .chain(decisions.iter().map(|d| d.tags.clone()))
        .collect();

    let mut cooccur: HashMap<(String, String), usize> = HashMap::new();
    for tags in &all_tag_sets {
        for (i, t1) in tags.iter().enumerate() {
            for t2 in tags.iter().skip(i + 1) {
                if concept_map.contains_key(t1) && concept_map.contains_key(t2) {
                    let key = if t1 < t2 {
                        (t1.clone(), t2.clone())
                    } else {
                        (t2.clone(), t1.clone())
                    };
                    *cooccur.entry(key).or_insert(0) += 1;
                }
            }
        }
    }

    for ((t1, t2), weight) in &cooccur {
        if let (Some(id1), Some(id2)) = (concept_map.get(t1), concept_map.get(t2)) {
            edges.push(GraphEdge {
                source: id1.clone(),
                target: id2.clone(),
                label: format!("co-occurs ({}x)", weight),
                edge_type: "co_occurrence".to_string(),
                weight: *weight as f64,
            });
        }
    }

    // Add debugging cluster nodes
    let debug_tags: Vec<&String> = tag_freq
        .keys()
        .filter(|t| {
            let tl = t.to_lowercase();
            tl.contains("debug") || tl.contains("fix") || tl.contains("error") || tl.contains("bug")
        })
        .collect();

    if !debug_tags.is_empty() {
        let cluster_id = "cluster-debugging".to_string();
        nodes.push(GraphNode {
            id: cluster_id.clone(),
            label: "Debugging Cluster".to_string(),
            node_type: "cluster".to_string(),
            metadata: {
                let mut m = HashMap::new();
                m.insert("count".to_string(), debug_tags.len().to_string());
                m
            },
        });
        for tag in &debug_tags {
            if let Some(cid) = concept_map.get(*tag) {
                edges.push(GraphEdge {
                    source: cluster_id.clone(),
                    target: cid.clone(),
                    label: "contains".to_string(),
                    edge_type: "cluster_member".to_string(),
                    weight: 1.0,
                });
            }
        }
    }

    // Add architecture cluster
    let arch_tags: Vec<&String> = tag_freq
        .keys()
        .filter(|t| {
            let tl = t.to_lowercase();
            tl.contains("arch") || tl.contains("design") || tl.contains("refactor")
                || tl.contains("migration") || tl.contains("struct")
        })
        .collect();

    if !arch_tags.is_empty() {
        let cluster_id = "cluster-architecture".to_string();
        nodes.push(GraphNode {
            id: cluster_id.clone(),
            label: "Architecture Cluster".to_string(),
            node_type: "cluster".to_string(),
            metadata: {
                let mut m = HashMap::new();
                m.insert("count".to_string(), arch_tags.len().to_string());
                m
            },
        });
        for tag in &arch_tags {
            if let Some(cid) = concept_map.get(*tag) {
                edges.push(GraphEdge {
                    source: cluster_id.clone(),
                    target: cid.clone(),
                    label: "contains".to_string(),
                    edge_type: "cluster_member".to_string(),
                    weight: 1.0,
                });
            }
        }
    }

    Graph {
        id: format!("mem-{}", current_timestamp_ms()),
        title: "Memory Graph".to_string(),
        graph_type: "memory".to_string(),
        nodes,
        edges,
        created_at: current_timestamp_ms(),
        project_path: project_path.map(|s| s.to_string()),
    }
}

/// Build a paginated/lazy graph — returns only the requested depth from a root node
pub fn build_lazy_graph(
    graph_type: &str,
    project_path: Option<&str>,
    root_node: Option<&str>,
    max_depth: usize,
    max_nodes: usize,
) -> Graph {
    let full_graph = match graph_type {
        "relationship" => build_relationship_graph(project_path),
        "architecture" => build_architecture_graph(project_path),
        "memory" => build_memory_graph(project_path),
        _ => build_relationship_graph(project_path),
    };

    if root_node.is_none() || full_graph.nodes.len() <= max_nodes {
        // If no root or graph is small enough, return as-is (capped)
        let mut graph = full_graph;
        graph.nodes.truncate(max_nodes);
        let node_ids: Vec<String> = graph.nodes.iter().map(|n| n.id.clone()).collect();
        graph.edges.retain(|e| node_ids.contains(&e.source) && node_ids.contains(&e.target));
        return graph;
    }

    let root = root_node.unwrap();

    // BFS from root up to max_depth
    let mut visited: Vec<String> = vec![root.to_string()];
    let mut frontier: Vec<String> = vec![root.to_string()];

    for _ in 0..max_depth {
        let mut next_frontier: Vec<String> = Vec::new();
        for node_id in &frontier {
            for edge in &full_graph.edges {
                let neighbor = if edge.source == *node_id {
                    &edge.target
                } else if edge.target == *node_id {
                    &edge.source
                } else {
                    continue;
                };
                if !visited.contains(neighbor) {
                    visited.push(neighbor.clone());
                    next_frontier.push(neighbor.clone());
                    if visited.len() >= max_nodes {
                        break;
                    }
                }
            }
            if visited.len() >= max_nodes {
                break;
            }
        }
        frontier = next_frontier;
        if frontier.is_empty() || visited.len() >= max_nodes {
            break;
        }
    }

    let nodes: Vec<GraphNode> = full_graph
        .nodes
        .into_iter()
        .filter(|n| visited.contains(&n.id))
        .collect();
    let edges: Vec<GraphEdge> = full_graph
        .edges
        .into_iter()
        .filter(|e| visited.contains(&e.source) && visited.contains(&e.target))
        .collect();

    Graph {
        id: format!("lazy-{}", current_timestamp_ms()),
        title: format!("Lazy {} (from {})", graph_type, root),
        graph_type: format!("{}_lazy", graph_type),
        nodes,
        edges,
        created_at: current_timestamp_ms(),
        project_path: project_path.map(|s| s.to_string()),
    }
}

/// Enhanced visual stats with memory graph info
#[derive(Debug, Clone, Serialize)]
pub struct EnhancedVisualStats {
    pub base: VisualStats,
    pub memory_graph_nodes: usize,
    pub memory_graph_edges: usize,
    pub concept_count: usize,
    pub cluster_count: usize,
}

pub fn get_enhanced_visual_stats(project_path: Option<&str>) -> EnhancedVisualStats {
    let base = get_visual_stats();
    let mem_graph = build_memory_graph(project_path);
    let concept_count = mem_graph.nodes.iter().filter(|n| n.node_type == "concept").count();
    let cluster_count = mem_graph.nodes.iter().filter(|n| n.node_type == "cluster").count();

    EnhancedVisualStats {
        base,
        memory_graph_nodes: mem_graph.nodes.len(),
        memory_graph_edges: mem_graph.edges.len(),
        concept_count,
        cluster_count,
    }
}
