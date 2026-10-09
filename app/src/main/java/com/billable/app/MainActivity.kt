package com.billable.app

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.fragment.app.Fragment
import com.billable.app.databinding.ActivityMainBinding
import com.billable.app.ui.clients.ClientsFragment
import com.billable.app.ui.invoices.InvoicesFragment
import com.billable.app.ui.settings.SettingsFragment
import com.billable.app.ui.track.TrackFragment

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    private val notifPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notifPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }

        if (savedInstanceState == null) {
            showFragment(TrackFragment())
        }

        binding.bottomNav.setOnItemSelectedListener { item ->
            val fragment: Fragment = when (item.itemId) {
                R.id.nav_track -> TrackFragment()
                R.id.nav_clients -> ClientsFragment()
                R.id.nav_invoices -> InvoicesFragment()
                R.id.nav_settings -> SettingsFragment()
                else -> TrackFragment()
            }
            showFragment(fragment)
            true
        }
    }

    private fun showFragment(fragment: Fragment) {
        supportFragmentManager.beginTransaction()
            .replace(R.id.fragment_container, fragment)
            .commit()
    }

    /** Lets other fragments (e.g. Settings, after saving a rate) jump the user back to Track. */
    fun goToTrackTab() {
        binding.bottomNav.selectedItemId = R.id.nav_track
    }
}
