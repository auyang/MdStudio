use std::{path::PathBuf, time::Duration};
use tauri::WebviewWindow;

#[cfg(target_os = "macos")]
mod macos_print_delegate {
    use objc2::{define_class, msg_send, rc::Retained, AnyThread, DefinedClass};
    use objc2_app_kit::NSPrintOperation;
    use objc2_foundation::{NSObject, NSObjectProtocol};
    use std::{
        path::PathBuf,
        sync::{mpsc::Sender, Mutex},
    };

    #[derive(Debug)]
    pub(super) struct PrintDelegateIvars {
        sender: Mutex<Option<Sender<Result<(), String>>>>,
        destination: PathBuf,
    }

    define_class!(
        #[unsafe(super = NSObject)]
        #[thread_kind = AnyThread]
        #[ivars = PrintDelegateIvars]
        pub(super) struct PrintDelegate;

        unsafe impl NSObjectProtocol for PrintDelegate {}

        impl PrintDelegate {
            #[unsafe(method(printOperationDidRun:success:contextInfo:))]
            fn did_run(
                &self,
                _operation: &NSPrintOperation,
                success: bool,
                _context_info: *mut std::ffi::c_void,
            ) {
                let result = if success {
                    std::fs::read(&self.ivars().destination)
                        .map_err(|_| "PDF 已生成，但无法读取输出文件。".to_string())
                        .and_then(|bytes| {
                            if bytes.starts_with(b"%PDF-") {
                                Ok(())
                            } else {
                                Err("PDF 内容无效，未写入有效文件。".into())
                            }
                        })
                } else {
                    Err("PDF 分页生成失败，请检查保存位置后重试。".into())
                };
                if let Some(sender) = self.ivars().sender.lock().unwrap().take() {
                    let _ = sender.send(result);
                }
            }
        }
    );

    impl PrintDelegate {
        pub(super) fn new(
            sender: Sender<Result<(), String>>,
            destination: PathBuf,
        ) -> Retained<Self> {
            let this = Self::alloc().set_ivars(PrintDelegateIvars {
                sender: Mutex::new(Some(sender)),
                destination,
            });
            // SAFETY: NSObject 的 init 方法签名与返回值类型匹配。
            unsafe { msg_send![super(this), init] }
        }
    }
}

pub fn export(window: &WebviewWindow, file_path: String) -> Result<(), String> {
    let destination = validate_destination(file_path)?;

    #[cfg(target_os = "macos")]
    return export_macos(window, destination);

    #[cfg(target_os = "windows")]
    return export_windows(window, destination);

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (window, destination);
        Err("当前平台暂不支持直接导出 PDF。".into())
    }
}

fn validate_destination(file_path: String) -> Result<PathBuf, String> {
    let mut path = PathBuf::from(file_path.trim());
    if !path.is_absolute() {
        return Err("PDF 保存位置无效。".into());
    }
    match path.extension().and_then(|extension| extension.to_str()) {
        Some(extension) if extension.eq_ignore_ascii_case("pdf") => {}
        Some(_) => return Err("PDF 文件扩展名无效。".into()),
        None => {
            path.set_extension("pdf");
        }
    }
    if !path.parent().is_some_and(|parent| parent.is_dir()) {
        return Err("PDF 保存目录不存在。".into());
    }
    Ok(path)
}

#[cfg(target_os = "macos")]
fn export_macos(window: &WebviewWindow, destination: PathBuf) -> Result<(), String> {
    use objc2::{sel, MainThreadMarker};
    use objc2_app_kit::{
        NSPrintHeaderAndFooter, NSPrintInfo, NSPrintJobSavingURL, NSPrintSaveJob,
        NSPrintingPaginationMode, NSPaperOrientation, NSWindow,
    };
    use objc2_foundation::{NSNumber, NSString, NSURL};
    use objc2_web_kit::WKWebView;
    use std::sync::{mpsc, Arc, Mutex};

    let (sender, receiver) = mpsc::channel();
    let delegate_holder = Arc::new(Mutex::new(None));
    let holder_for_webview = Arc::clone(&delegate_holder);
    window
        .with_webview(move |webview| {
            let Some(_main_thread) = MainThreadMarker::new() else {
                let _ = sender.send(Err("无法从主线程生成 PDF。".into()));
                return;
            };
            let view = unsafe { &*webview.inner().cast::<WKWebView>() };
            // WKWebView 的 createPDF 会生成内容快照，长文档可能被压成一张超长页面。
            // 通过原生打印操作交给 WebKit 分页，并明确设定 A4、页边距和保存路径。
            let print_info = NSPrintInfo::new();
            print_info.setPaperSize(objc2_foundation::NSSize::new(595.28, 841.89));
            print_info.setOrientation(NSPaperOrientation::Portrait);
            print_info.setLeftMargin(51.02);
            print_info.setRightMargin(51.02);
            print_info.setTopMargin(51.02);
            print_info.setBottomMargin(51.02);
            print_info.setHorizontalPagination(NSPrintingPaginationMode::Automatic);
            print_info.setVerticalPagination(NSPrintingPaginationMode::Automatic);
            print_info.setJobDisposition(unsafe { NSPrintSaveJob });
            // 页边距由 NSPrintInfo 唯一控制，避免与 CSS @page 重复叠加。
            // 关闭 WebKit 打印生成的默认页眉与页脚。
            let attributes = unsafe { print_info.dictionary() };
            attributes.insert(unsafe { NSPrintHeaderAndFooter }, &NSNumber::new_bool(false));

            let path = NSString::from_str(&destination.to_string_lossy());
            let file_url = NSURL::fileURLWithPath(&path);
            // NSPrintInfo 将保存地址作为属性存储在可变字典中。
            attributes.insert(unsafe { NSPrintJobSavingURL }, file_url.as_ref());

            let operation = unsafe { view.printOperationWithPrintInfo(&print_info) };
            operation.setShowsPrintPanel(false);
            operation.setShowsProgressPanel(false);
            operation.setCanSpawnSeparateThread(true);
            let delegate = macos_print_delegate::PrintDelegate::new(sender, destination);
            *holder_for_webview.lock().unwrap() = Some(delegate.clone());
            let ns_window = unsafe { &*webview.ns_window().cast::<NSWindow>() };
            // 异步模态打印会把排版工作放到独立线程，避免主线程被长文档打印阻塞。
            unsafe {
                operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                    ns_window,
                    Some(&*delegate),
                    Some(sel!(printOperationDidRun:success:contextInfo:)),
                    std::ptr::null_mut(),
                );
            }
        })
        .map_err(|_| "无法连接到应用阅读页面。".to_string())?;

    match receiver.recv_timeout(Duration::from_secs(120)) {
        Ok(result) => {
            // 回调在发送完成结果后立即返回；短暂保留 delegate，避免提前释放 Objective-C 对象。
            std::thread::sleep(Duration::from_millis(50));
            delegate_holder.lock().unwrap().take();
            result
        }
        Err(_) => {
            let holder_for_cleanup = Arc::clone(&delegate_holder);
            std::thread::spawn(move || {
                if receiver.recv().is_ok() {
                    std::thread::sleep(Duration::from_millis(50));
                    holder_for_cleanup.lock().unwrap().take();
                }
            });
            Err("PDF 生成超时，请重试。".into())
        }
    }
}

#[cfg(target_os = "windows")]
fn export_windows(window: &WebviewWindow, destination: PathBuf) -> Result<(), String> {
    use std::sync::mpsc;
    use webview2_com::{
        Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Environment6, ICoreWebView2PrintSettings, ICoreWebView2_7,
            COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
        },
        PrintToPdfCompletedHandler,
    };
    use windows::core::{Error, Interface, HRESULT, HSTRING};

    let (sender, receiver) = mpsc::channel();
    window
        .with_webview(move |webview| {
            let result = (|| {
                let controller = webview.controller();
                let core = unsafe { controller.CoreWebView2() }
                    .map_err(|_| "无法访问 Windows 阅读页面。".to_string())?;
                let core = core
                    .cast::<ICoreWebView2_7>()
                    .map_err(|_| "当前 WebView2 版本不支持 PDF 导出。".to_string())?;
                let environment = unsafe { core.Environment() }
                    .map_err(|_| "无法获取 PDF 导出环境。".to_string())?;
                let environment = environment
                    .cast::<ICoreWebView2Environment6>()
                    .map_err(|_| "当前 WebView2 版本不支持 PDF 页面设置。".to_string())?;
                let print_settings = unsafe { environment.CreatePrintSettings() }
                    .map_err(|_| "无法初始化 PDF 页面设置。".to_string())?;
                unsafe {
                    print_settings
                        .SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT)
                        .map_err(|_| "无法设置 PDF 纵向页面。".to_string())?;
                    print_settings
                        .SetPageWidth(8.2677)
                        .map_err(|_| "无法设置 PDF 页面宽度。".to_string())?;
                    print_settings
                        .SetPageHeight(11.6929)
                        .map_err(|_| "无法设置 PDF 页面高度。".to_string())?;
                    print_settings
                        .SetMarginTop(0.7087)
                        .map_err(|_| "无法设置 PDF 页边距。".to_string())?;
                    print_settings
                        .SetMarginBottom(0.7087)
                        .map_err(|_| "无法设置 PDF 页边距。".to_string())?;
                    print_settings
                        .SetMarginLeft(0.7087)
                        .map_err(|_| "无法设置 PDF 页边距。".to_string())?;
                    print_settings
                        .SetMarginRight(0.7087)
                        .map_err(|_| "无法设置 PDF 页边距。".to_string())?;
                    print_settings
                        .SetShouldPrintBackgrounds(true)
                        .map_err(|_| "无法启用 PDF 文档背景。".to_string())?;
                    print_settings
                        .SetShouldPrintHeaderAndFooter(false)
                        .map_err(|_| "无法隐藏 PDF 页眉页脚。".to_string())?;
                }
                let path = HSTRING::from(destination.to_string_lossy().as_ref());

                PrintToPdfCompletedHandler::wait_for_async_operation(
                    Box::new(move |handler| unsafe {
                        core.PrintToPdf(&path, Some(&print_settings), handler)
                            .map_err(Into::into)
                    }),
                    Box::new(|status, succeeded| {
                        status?;
                        if succeeded {
                            Ok(())
                        } else {
                            Err(Error::new(
                                HRESULT(0x8000_4005_u32 as i32),
                                "WebView2 could not create the PDF".into(),
                            ))
                        }
                    }),
                )
                .map_err(|_| "PDF 生成失败，请检查保存位置后重试。".to_string())
            })();
            let _ = sender.send(result);
        })
        .map_err(|_| "无法连接到应用阅读页面。".to_string())?;

    receiver
        .recv_timeout(Duration::from_secs(120))
        .map_err(|_| "PDF 生成超时，请重试。".to_string())?
}
