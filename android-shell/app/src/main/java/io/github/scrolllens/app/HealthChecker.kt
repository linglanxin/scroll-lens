package io.github.scrolllens.app

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class HealthResult(
    val ok: Boolean,
    val latencyMs: Long,
    val message: String
)

object HealthChecker {

    fun check(baseUrl: String): HealthResult {
        val target = ServerUrlNormalizer.healthUrl(baseUrl)
        if (target.isEmpty() || !ServerUrlNormalizer.isValidHttpUrl(baseUrl)) {
            return HealthResult(ok = false, latencyMs = 0, message = "Invalid URL")
        }

        val start = System.currentTimeMillis()
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL(target).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 5000
                readTimeout = 5000
                setRequestProperty("Accept", "application/json")
            }
            val code = conn.responseCode
            val latency = System.currentTimeMillis() - start
            if (code in 200..299) {
                val body = conn.inputStream.bufferedReader().use { it.readText() }
                val json = JSONObject(body)
                if (json.optString("status") == "ok") {
                    HealthResult(ok = true, latencyMs = latency, message = "ok")
                } else {
                    HealthResult(ok = false, latencyMs = latency, message = "Unexpected health payload")
                }
            } else {
                HealthResult(ok = false, latencyMs = latency, message = "HTTP $code")
            }
        } catch (e: Exception) {
            val latency = System.currentTimeMillis() - start
            HealthResult(
                ok = false,
                latencyMs = latency,
                message = e.localizedMessage ?: e.javaClass.simpleName
            )
        } finally {
            conn?.disconnect()
        }
    }
}
