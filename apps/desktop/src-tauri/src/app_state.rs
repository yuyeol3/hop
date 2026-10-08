use std::sync::Mutex;

use crate::pending_open::PendingOpenPaths;

/// Native state shared by all windows. Documents live in each window's studio, not here.
#[derive(Default)]
pub struct AppState {
    pub(crate) pending_open_paths: PendingOpenPaths,
    pub quit_requests: Mutex<crate::app_quit::AppQuitState>,
    pub updater: Mutex<crate::updates::UpdateManagerState>,
}
