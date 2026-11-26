package io.github.scrolllens.app

import android.app.Activity
import android.content.Intent
import android.webkit.JavascriptInterface

class ScrollLensBridge(
    private val activity: Activity,
    private val serverStore: ServerStore
) {

    @JavascriptInterface
    fun openServerConfig() {
        activity.runOnUiThread {
            activity.startActivity(Intent(activity, ServerConfigActivity::class.java))
        }
    }

    @JavascriptInterface
    fun getServerUrl(): String {
        return serverStore.getActiveServer()?.url ?: ""
    }

    @JavascriptInterface
    fun getAppVersion(): String {
        return BuildConfig.VERSION_NAME
    }
}
