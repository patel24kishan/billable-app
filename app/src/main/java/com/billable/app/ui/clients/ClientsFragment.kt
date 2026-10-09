package com.billable.app.ui.clients

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Toast
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.LinearLayoutManager
import com.billable.app.data.Client
import com.billable.app.data.DbHelper
import com.billable.app.databinding.FragmentClientsBinding
import com.billable.app.ui.common.ClientAdapter

class ClientsFragment : Fragment() {

    private var _binding: FragmentClientsBinding? = null
    private val binding get() = _binding!!
    private lateinit var db: DbHelper
    private lateinit var adapter: ClientAdapter
    private var editingId: Long? = null

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        _binding = FragmentClientsBinding.inflate(inflater, container, false)
        db = DbHelper(requireContext())
        return binding.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        adapter = ClientAdapter(emptyList(), ::startEdit, ::toggleArchive, ::confirmDelete)
        binding.rvClients.adapter = adapter
        binding.rvClients.layoutManager = LinearLayoutManager(requireContext())
        binding.rvClients.itemAnimator = null

        binding.btnSave.setOnClickListener { save() }
        binding.btnCancel.setOnClickListener { resetForm() }
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }

    private fun refresh() {
        val clients = db.getClients(includeArchived = true)
        adapter.submit(clients)
        binding.tvEmpty.visibility = if (clients.isEmpty()) View.VISIBLE else View.GONE
    }

    private fun save() {
        val name = binding.etName.text.toString().trim()
        if (name.isEmpty()) { toast("Enter a client name."); return }
        val email = binding.etEmail.text.toString().trim()
        val address = binding.etAddress.text.toString().trim()
        val id = editingId
        if (id != null) db.updateClient(id, name, email, address) else db.insertClient(name, email, address)
        toast(if (id != null) "Client updated." else "Client added.")
        resetForm()
        refresh()
    }

    private fun startEdit(c: Client) {
        editingId = c.id
        binding.etName.setText(c.name); binding.etEmail.setText(c.email); binding.etAddress.setText(c.address)
        binding.tvFormTitle.text = "Edit client"
        binding.btnSave.text = "Save Changes"
        binding.btnCancel.visibility = View.VISIBLE
    }

    private fun resetForm() {
        editingId = null
        binding.etName.setText(""); binding.etEmail.setText(""); binding.etAddress.setText("")
        binding.tvFormTitle.text = "Add a client"
        binding.btnSave.text = "Add Client"
        binding.btnCancel.visibility = View.GONE
    }

    private fun toggleArchive(c: Client) {
        db.setClientArchived(c.id, !c.archived)
        refresh()
    }

    private fun confirmDelete(c: Client) {
        android.app.AlertDialog.Builder(requireContext())
            .setMessage("Delete this client permanently? Past time entries and invoices keep their record, but you won't be able to log new time for them.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Delete") { _, _ -> db.deleteClient(c.id); refresh() }
            .show()
    }

    private fun toast(msg: String) = Toast.makeText(requireContext(), msg, Toast.LENGTH_SHORT).show()
}
