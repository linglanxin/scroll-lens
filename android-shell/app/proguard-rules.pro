# Keep JS Bridge methods callable by WebView JavaScript
-keepclassmembers class io.github.scrolllens.app.ScrollLensBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
