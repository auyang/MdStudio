mod commands;
mod services;

use commands::{enqueue_open_file, is_markdown_file, PendingOpenFiles, ReaderImageRegistry};
use services::watcher::FileWatcherService;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[cfg(desktop)]
const SETTINGS_ABOUT_MENU_ID: &str = "show_settings_about";

#[cfg(desktop)]
fn application_menu<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::menu::Menu<R>> {
    application_menu_for_locale(app, "zh-CN")
}

#[cfg(desktop)]
pub(crate) fn application_menu_for_locale<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    locale: &str,
) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

    let (about_label, file_label, edit_label, _view_label, window_label, help_label) = match locale {
        "en" => ("About MdStudio", "File", "Edit", "View", "Window", "Help"),
        "ja" => (
            "MdStudio について",
            "ファイル",
            "編集",
            "表示",
            "ウインドウ",
            "ヘルプ",
        ),
        _ => ("关于 MdStudio", "文件", "编辑", "视图", "窗口", "帮助"),
    };

    #[cfg(target_os = "macos")]
    let app_menu = {
        let about =
            MenuItem::with_id(app, SETTINGS_ABOUT_MENU_ID, about_label, true, None::<&str>)?;
        Submenu::with_items(
            app,
            app.package_info().name.clone(),
            true,
            &[
                &about,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::services(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::hide(app, None)?,
                &PredefinedMenuItem::hide_others(app, None)?,
                &PredefinedMenuItem::separator(app)?,
                &PredefinedMenuItem::quit(app, None)?,
            ],
        )?
    };

    #[cfg(not(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    )))]
    let file_menu = Submenu::with_items(
        app,
        file_label,
        true,
        &[
            &PredefinedMenuItem::close_window(app, None)?,
            #[cfg(not(target_os = "macos"))]
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        edit_label,
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    let view_menu = Submenu::with_items(
        app,
        _view_label,
        true,
        &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?;

    let window_menu = Submenu::with_items(
        app,
        window_label,
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            #[cfg(target_os = "macos")]
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    #[cfg(target_os = "macos")]
    let help_menu = Submenu::with_items(app, help_label, true, &[])?;

    #[cfg(not(target_os = "macos"))]
    let help_menu = {
        let about =
            MenuItem::with_id(app, SETTINGS_ABOUT_MENU_ID, about_label, true, None::<&str>)?;
        Submenu::with_items(app, help_label, true, &[&about])?
    };

    #[cfg(target_os = "macos")]
    let menu = Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )?;

    #[cfg(not(target_os = "macos"))]
    let menu = {
        #[cfg(not(any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "netbsd",
            target_os = "openbsd"
        )))]
        let menu = Menu::with_items(app, &[&file_menu, &edit_menu, &window_menu, &help_menu])?;

        #[cfg(any(
            target_os = "linux",
            target_os = "dragonfly",
            target_os = "freebsd",
            target_os = "netbsd",
            target_os = "openbsd"
        ))]
        let menu = Menu::with_items(app, &[&edit_menu, &window_menu, &help_menu])?;
        menu
    };

    Ok(menu)
}

fn startup_markdown_paths() -> Vec<String> {
    std::env::args_os()
        .skip(1)
        .filter_map(|argument| argument.into_string().ok())
        .filter_map(|argument| {
            let path = PathBuf::from(argument);
            (is_markdown_file(&path) && path.is_file())
                .then(|| path.canonicalize().ok())
                .flatten()
                .map(|path| path.to_string_lossy().into_owned())
        })
        .collect()
}

fn incoming_arguments(args: &[String], cwd: &str) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter_map(|argument| {
            let path = Path::new(argument);
            let path = if path.is_absolute() {
                path.to_path_buf()
            } else {
                Path::new(cwd).join(path)
            };
            (is_markdown_file(&path) && path.is_file())
                .then(|| path.canonicalize().ok())
                .flatten()
                .map(|path| path.to_string_lossy().into_owned())
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(feature = "perf-benchmark")]
    commands::mark_performance_app_started();
    let initial_paths = startup_markdown_paths();
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.menu(application_menu).on_menu_event(|app, event| {
        use tauri::Emitter;
        if event.id() == SETTINGS_ABOUT_MENU_ID {
            let _ = app.emit("mdstudio:show-settings-about", ());
        }
    });
    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        for path in incoming_arguments(&args, &cwd) {
            enqueue_open_file(app, path);
        }
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));
    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .manage(PendingOpenFiles::new(initial_paths))
        .manage(ReaderImageRegistry::default())
        .setup(|app| {
            app.manage(FileWatcherService::default());
            Ok(())
        });
    #[cfg(not(feature = "perf-benchmark"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::load_reader_document,
        commands::load_reader_image,
        commands::release_reader_image_document,
        commands::normalize_reader_path,
        commands::take_pending_open_files,
        commands::set_reader_watch,
        commands::open_external_url,
        commands::export_reader_pdf,
        commands::set_application_locale
    ]);
    #[cfg(feature = "perf-benchmark")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::load_reader_document,
        commands::load_reader_image,
        commands::release_reader_image_document,
        commands::normalize_reader_path,
        commands::take_pending_open_files,
        commands::set_reader_watch,
        commands::open_external_url,
        commands::export_reader_pdf,
        commands::set_application_locale,
        commands::record_performance_sample
    ]);
    let app = builder
        .build(tauri::generate_context!())
        .expect("启动 MdStudio 时发生错误");

    app.run(|_handle, _event| {
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "android"))]
        if let tauri::RunEvent::Opened { urls } = _event {
            for url in urls {
                if let Ok(path) = url.to_file_path() {
                    if path.is_file() && is_markdown_file(&path) {
                        if let Ok(path) = path.canonicalize() {
                            enqueue_open_file(_handle, path.to_string_lossy().into_owned());
                        }
                    }
                }
            }
        }
    });
}
