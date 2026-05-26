use crate::ollopa_events::AppEvent;
use serde::Serialize;
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex};

const CHANNEL_CAPACITY: usize = 256;

/// Event history entry with timestamp
#[derive(Debug, Clone, Serialize)]
pub struct TimestampedEvent {
    pub timestamp_ms: u64,
    pub event: AppEvent,
}

/// Central event bus for the application.
///
/// All internal events flow through here. The frontend subscribes
/// via Tauri's event system, but the bus also maintains a bounded
/// history for late-joining listeners and session replay.
#[allow(dead_code)]
pub struct EventBus {
    sender: broadcast::Sender<AppEvent>,
    history: Arc<Mutex<Vec<TimestampedEvent>>>,
    max_history: usize,
}

impl EventBus {
    pub fn new() -> Self {
        let (sender, _) = broadcast::channel(CHANNEL_CAPACITY);
        Self {
            sender,
            history: Arc::new(Mutex::new(Vec::new())),
            max_history: 1000,
        }
    }

    /// Publish an event to all subscribers and record in history.
    #[allow(dead_code)]
    pub async fn publish(&self, event: AppEvent) {
        let timestamped = TimestampedEvent {
            timestamp_ms: current_timestamp_ms(),
            event: event.clone(),
        };

        // Record in history
        let mut history = self.history.lock().await;
        history.push(timestamped);
        if history.len() > self.max_history {
            let drain_count = history.len() - self.max_history;
            history.drain(..drain_count);
        }
        drop(history);

        // Broadcast (ignore error if no receivers)
        let _ = self.sender.send(event);
    }

    /// Subscribe to the event stream.
    #[allow(dead_code)]
    pub fn subscribe(&self) -> broadcast::Receiver<AppEvent> {
        self.sender.subscribe()
    }

    /// Get recent event history (for session recovery / late joiners).
    pub async fn recent_events(&self, limit: usize) -> Vec<TimestampedEvent> {
        let history = self.history.lock().await;
        let start = if history.len() > limit {
            history.len() - limit
        } else {
            0
        };
        history[start..].to_vec()
    }

    /// Clear event history (e.g., on session restart).
    pub async fn clear_history(&self) {
        self.history.lock().await.clear();
    }
}

#[allow(dead_code)]
fn current_timestamp_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
