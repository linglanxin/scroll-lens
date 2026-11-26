package io.github.scrolllens.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

data class ServerProfile(
    val id: String,
    val name: String,
    val url: String
)

class ServerStore(context: Context) {

    private val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun listServers(): List<ServerProfile> {
        val raw = prefs.getString(KEY_SERVERS, "[]") ?: "[]"
        val out = mutableListOf<ServerProfile>()
        try {
            val arr = JSONArray(raw)
            for (i in 0 until arr.length()) {
                val obj = arr.optJSONObject(i) ?: continue
                val id = obj.optString("id")
                val name = obj.optString("name")
                val url = ServerUrlNormalizer.normalize(obj.optString("url"))
                if (id.isNotBlank() && url.isNotBlank()) {
                    out.add(ServerProfile(id = id, name = name.ifBlank { url }, url = url))
                }
            }
        } catch (_: Exception) {
        }
        return out
    }

    fun getActiveServerId(): String? {
        return prefs.getString(KEY_ACTIVE_ID, null)?.takeIf { it.isNotBlank() }
    }

    fun getActiveServer(): ServerProfile? {
        val servers = listServers()
        if (servers.isEmpty()) return null
        val activeId = getActiveServerId()
        return servers.firstOrNull { it.id == activeId } ?: servers.first()
    }

    fun saveAndActivate(name: String, rawUrl: String): ServerProfile {
        val url = ServerUrlNormalizer.normalize(rawUrl)
        require(ServerUrlNormalizer.isValidHttpUrl(url)) { "Invalid server URL" }

        val displayName = name.trim().ifBlank { url }
        val current = listServers().toMutableList()
        val existingIdx = current.indexOfFirst { it.url.equals(url, ignoreCase = true) }

        val profile = if (existingIdx >= 0) {
            val updated = current[existingIdx].copy(name = displayName, url = url)
            current[existingIdx] = updated
            updated
        } else {
            val created = ServerProfile(
                id = UUID.randomUUID().toString(),
                name = displayName,
                url = url
            )
            current.add(0, created)
            created
        }

        persist(current, profile.id)
        return profile
    }

    fun setActive(serverId: String) {
        val servers = listServers()
        if (servers.any { it.id == serverId }) {
            prefs.edit().putString(KEY_ACTIVE_ID, serverId).apply()
        }
    }

    fun delete(serverId: String) {
        val remaining = listServers().filterNot { it.id == serverId }
        val activeId = getActiveServerId()
        val nextActive = if (activeId == serverId) remaining.firstOrNull()?.id else activeId
        persist(remaining, nextActive)
    }

    private fun persist(servers: List<ServerProfile>, activeId: String?) {
        val arr = JSONArray()
        for (s in servers) {
            arr.put(
                JSONObject().apply {
                    put("id", s.id)
                    put("name", s.name)
                    put("url", s.url)
                }
            )
        }
        prefs.edit()
            .putString(KEY_SERVERS, arr.toString())
            .putString(KEY_ACTIVE_ID, activeId)
            .apply()
    }

    companion object {
        private const val PREFS_NAME = "scroll_lens_servers"
        private const val KEY_SERVERS = "servers_json"
        private const val KEY_ACTIVE_ID = "active_server_id"
    }
}
