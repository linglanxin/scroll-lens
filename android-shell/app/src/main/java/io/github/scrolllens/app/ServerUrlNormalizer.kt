package io.github.scrolllens.app

import java.net.URI

object ServerUrlNormalizer {

    fun normalize(raw: String): String {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return ""
        val withScheme = if (trimmed.contains("://")) {
            trimmed
        } else {
            "http://$trimmed"
        }
        return withScheme.trimEnd('/')
    }

    fun isValidHttpUrl(raw: String): Boolean {
        val normalized = normalize(raw)
        if (normalized.isEmpty()) return false
        return try {
            val uri = URI(normalized)
            val scheme = uri.scheme?.lowercase()
            (scheme == "http" || scheme == "https") && !uri.host.isNullOrBlank()
        } catch (_: Exception) {
            false
        }
    }

    fun healthUrl(baseUrl: String): String {
        val normalized = normalize(baseUrl)
        return if (normalized.isEmpty()) "" else "$normalized/api/v1/health"
    }
}
