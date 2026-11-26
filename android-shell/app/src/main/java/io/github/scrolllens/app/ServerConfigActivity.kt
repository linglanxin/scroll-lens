package io.github.scrolllens.app

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.button.MaterialButton
import com.google.android.material.textfield.TextInputEditText
import java.util.concurrent.Executors

class ServerConfigActivity : AppCompatActivity() {

    private lateinit var serverStore: ServerStore
    private lateinit var etServerName: TextInputEditText
    private lateinit var etServerUrl: TextInputEditText
    private lateinit var btnTest: MaterialButton
    private lateinit var btnSave: MaterialButton
    private lateinit var tvTestStatus: TextView
    private lateinit var tvEmptyServers: TextView
    private lateinit var rvServers: RecyclerView
    private lateinit var adapter: ServerListAdapter

    private val executor = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_server_config)

        serverStore = ServerStore(this)
        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        if (serverStore.getActiveServer() != null) {
            toolbar.setNavigationIcon(R.drawable.ic_arrow_back)
            toolbar.setNavigationOnClickListener { finish() }
        }

        etServerName = findViewById(R.id.etServerName)
        etServerUrl = findViewById(R.id.etServerUrl)
        btnTest = findViewById(R.id.btnTest)
        btnSave = findViewById(R.id.btnSave)
        tvTestStatus = findViewById(R.id.tvTestStatus)
        tvEmptyServers = findViewById(R.id.tvEmptyServers)
        rvServers = findViewById(R.id.rvServers)

        serverStore.getActiveServer()?.let { active ->
            etServerName.setText(active.name)
            etServerUrl.setText(active.url)
        }

        adapter = ServerListAdapter(
            onSwitch = { profile ->
                serverStore.setActive(profile.id)
                finish()
            },
            onDelete = { profile ->
                serverStore.delete(profile.id)
                refreshList()
            }
        )
        rvServers.layoutManager = LinearLayoutManager(this)
        rvServers.adapter = adapter
        refreshList()

        btnTest.setOnClickListener { runHealthTest() }
        btnSave.setOnClickListener { saveAndOpen() }
    }

    override fun onDestroy() {
        super.onDestroy()
        executor.shutdownNow()
    }

    private fun runHealthTest() {
        val rawUrl = etServerUrl.text?.toString().orEmpty()
        if (!ServerUrlNormalizer.isValidHttpUrl(rawUrl)) {
            showStatus(getString(R.string.invalid_url_msg), isError = true)
            return
        }
        btnTest.isEnabled = false
        showStatus(getString(R.string.testing_connection), isError = false)
        val normalized = ServerUrlNormalizer.normalize(rawUrl)

        executor.execute {
            val result = HealthChecker.check(normalized)
            runOnUiThread {
                btnTest.isEnabled = true
                if (result.ok) {
                    showStatus(getString(R.string.connection_ok_fmt, result.latencyMs), isError = false, isSuccess = true)
                } else {
                    showStatus(getString(R.string.connection_fail_fmt, result.message), isError = true)
                }
            }
        }
    }

    private fun saveAndOpen() {
        val rawUrl = etServerUrl.text?.toString().orEmpty()
        if (!ServerUrlNormalizer.isValidHttpUrl(rawUrl)) {
            showStatus(getString(R.string.invalid_url_msg), isError = true)
            return
        }
        val name = etServerName.text?.toString().orEmpty()
        serverStore.saveAndActivate(name, rawUrl)
        finish()
    }

    private fun refreshList() {
        val servers = serverStore.listServers()
        val activeId = serverStore.getActiveServer()?.id
        adapter.submit(servers, activeId)
        tvEmptyServers.visibility = if (servers.isEmpty()) View.VISIBLE else View.GONE
    }

    private fun showStatus(msg: String, isError: Boolean, isSuccess: Boolean = false) {
        tvTestStatus.visibility = View.VISIBLE
        tvTestStatus.text = msg
        val colorRes = when {
            isError -> R.color.error_red
            isSuccess -> R.color.success_green
            else -> R.color.text_secondary
        }
        tvTestStatus.setTextColor(ContextCompat.getColor(this, colorRes))
    }
}

private class ServerListAdapter(
    private val onSwitch: (ServerProfile) -> Unit,
    private val onDelete: (ServerProfile) -> Unit
) : RecyclerView.Adapter<ServerListAdapter.VH>() {

    private var items: List<ServerProfile> = emptyList()
    private var activeId: String? = null

    fun submit(list: List<ServerProfile>, currentActiveId: String?) {
        items = list
        activeId = currentActiveId
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_server, parent, false)
        return VH(view)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val item = items[position]
        val isActive = item.id == activeId
        holder.tvName.text = item.name
        holder.tvUrl.text = item.url
        holder.tvBadge.visibility = if (isActive) View.VISIBLE else View.GONE
        holder.btnSwitch.isEnabled = !isActive
        holder.btnSwitch.setOnClickListener { onSwitch(item) }
        holder.btnDelete.setOnClickListener { onDelete(item) }
    }

    override fun getItemCount(): Int = items.size

    class VH(view: View) : RecyclerView.ViewHolder(view) {
        val tvName: TextView = view.findViewById(R.id.tvItemName)
        val tvUrl: TextView = view.findViewById(R.id.tvItemUrl)
        val tvBadge: TextView = view.findViewById(R.id.tvActiveBadge)
        val btnSwitch: MaterialButton = view.findViewById(R.id.btnSwitch)
        val btnDelete: MaterialButton = view.findViewById(R.id.btnDelete)
    }
}
