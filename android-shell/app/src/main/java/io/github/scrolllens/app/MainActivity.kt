package io.github.scrolllens.app

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.FrameLayout
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowInsetsControllerCompat
import com.google.android.material.button.MaterialButton

class MainActivity : AppCompatActivity() {

    private lateinit var serverStore: ServerStore
    private lateinit var rootContainer: FrameLayout
    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private lateinit var errorOverlay: LinearLayout
    private lateinit var tvErrorDetail: TextView
    private lateinit var btnRetry: MaterialButton
    private lateinit var btnSwitchServer: MaterialButton

    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var loadedServerUrl: String? = null
    private var lastBackPressedMs: Long = 0L
    private var launchingServerConfig: Boolean = false

    private val serverConfigLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) {
        launchingServerConfig = false
        val active = serverStore.getActiveServer()
        if (active == null) {
            finish()
        } else if (loadedServerUrl != active.url) {
            loadServer(active.url)
        }
    }

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val callback = filePathCallback
        filePathCallback = null
        if (callback == null) return@registerForActivityResult

        val uris: Array<Uri>? = if (result.resultCode == RESULT_OK) {
            val data = result.data
            when {
                data?.clipData != null -> {
                    val clip = data.clipData!!
                    Array(clip.itemCount) { i -> clip.getItemAt(i).uri }
                }
                data?.data != null -> arrayOf(data.data!!)
                else -> null
            }
        } else {
            null
        }
        callback.onReceiveValue(uris)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        serverStore = ServerStore(this)
        rootContainer = findViewById(R.id.rootContainer)
        webView = findViewById(R.id.webView)
        progressBar = findViewById(R.id.progressBar)
        errorOverlay = findViewById(R.id.errorOverlay)
        tvErrorDetail = findViewById(R.id.tvErrorDetail)
        btnRetry = findViewById(R.id.btnRetry)
        btnSwitchServer = findViewById(R.id.btnSwitchServer)

        configureWebView()
        configureListeners()
        registerBackNavigation()

        val active = serverStore.ensureDefaultServer(
            BuildConfig.DEFAULT_SERVER_URL,
            BuildConfig.DEFAULT_SERVER_NAME
        )
        if (active == null) {
            launchServerConfigOnce()
        } else {
            loadServer(active.url)
        }
    }

    override fun onResume() {
        super.onResume()
        val active = serverStore.getActiveServer()
        if (active == null) {
            launchServerConfigOnce()
            return
        }
        if (loadedServerUrl != active.url) {
            loadServer(active.url)
        }
    }

    private fun launchServerConfigOnce() {
        if (launchingServerConfig) return
        launchingServerConfig = true
        serverConfigLauncher.launch(Intent(this, ServerConfigActivity::class.java))
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            useWideViewPort = true
            loadWithOverviewMode = true
            userAgentString = "$userAgentString ScrollLensAndroid/${BuildConfig.VERSION_NAME}"
        }

        webView.addJavascriptInterface(ScrollLensBridge(this, serverStore), "ScrollLensApp")

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                errorOverlay.visibility = View.GONE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                progressBar.visibility = View.GONE
            }

            override fun onReceivedError(
                view: WebView?,
                request: WebResourceRequest?,
                error: WebResourceError?
            ) {
                if (request?.isForMainFrame == true) {
                    progressBar.visibility = View.GONE
                    val desc = error?.description?.toString()?.takeIf { it.isNotBlank() }
                        ?: getString(R.string.offline_desc)
                    tvErrorDetail.text = desc
                    errorOverlay.visibility = View.VISIBLE
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView?, newProgress: Int) {
                if (newProgress in 1..99) {
                    progressBar.visibility = View.VISIBLE
                    progressBar.progress = newProgress
                } else {
                    progressBar.visibility = View.GONE
                }
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback

                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    // Use "*/*" without strict EXTRA_MIME_TYPES so Android file pickers
                    // do not gray out ebook formats like .mobi, .azw3, .fb2, or .md.
                    type = "*/*"
                }
                return try {
                    fileChooserLauncher.launch(intent)
                    true
                } catch (_: Exception) {
                    this@MainActivity.filePathCallback?.onReceiveValue(null)
                    this@MainActivity.filePathCallback = null
                    false
                }
            }
        }
    }

    private fun configureListeners() {
        btnRetry.setOnClickListener {
            errorOverlay.visibility = View.GONE
            val currentUrl = serverStore.getActiveServer()?.url
            if (currentUrl != null) {
                loadServer(currentUrl)
            }
        }
        btnSwitchServer.setOnClickListener {
            launchServerConfigOnce()
        }
    }

    private fun registerBackNavigation() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript(
                    "(function(){ return Boolean(window.__scrollLensHandleBack && window.__scrollLensHandleBack()); })()"
                ) { raw ->
                    if (raw == "true") {
                        return@evaluateJavascript
                    }
                    if (webView.canGoBack()) {
                        webView.goBack()
                        return@evaluateJavascript
                    }
                    val now = System.currentTimeMillis()
                    if (now - lastBackPressedMs < 2000L) {
                        finish()
                    } else {
                        lastBackPressedMs = now
                        Toast.makeText(
                            this@MainActivity,
                            R.string.back_press_exit_hint,
                            Toast.LENGTH_SHORT
                        ).show()
                    }
                }
            }
        })
    }

    private fun loadServer(url: String) {
        loadedServerUrl = url
        errorOverlay.visibility = View.GONE
        webView.loadUrl(url)
    }

    @Suppress("DEPRECATION")
    fun applySystemBarTheme(isDark: Boolean) {
        val statusColor = Color.parseColor(if (isDark) "#15171A" else "#FFFFFF")
        val navColor = Color.parseColor(if (isDark) "#0E0F11" else "#F8F8F6")
        window.statusBarColor = statusColor
        window.navigationBarColor = navColor
        rootContainer.setBackgroundColor(statusColor)
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.isAppearanceLightStatusBars = !isDark
        controller.isAppearanceLightNavigationBars = !isDark
    }
}
