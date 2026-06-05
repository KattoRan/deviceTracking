package expo.modules.cellinfo

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.CellInfo
import android.telephony.CellInfoGsm
import android.telephony.CellInfoLte
import android.telephony.CellInfoNr
import android.telephony.CellInfoWcdma
import android.telephony.CellIdentityNr
import android.telephony.CellSignalStrengthNr
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CellInfoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("CellInfoModule")

    AsyncFunction("getCellInfo") getCellInfo@{
      val context = appContext.reactContext
        ?: throw Exceptions.ReactContextLost()

      if (!hasRequiredPermissions(context)) {
        return@getCellInfo emptyList<Map<String, Any?>>()
      }

      val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
        ?: return@getCellInfo emptyList<Map<String, Any?>>()

      val all: List<CellInfo> = try {
        tm.allCellInfo ?: emptyList()
      } catch (_: SecurityException) {
        return@getCellInfo emptyList<Map<String, Any?>>()
      }

      all.mapNotNull { info -> info.toMap() }
    }
  }

  private fun hasRequiredPermissions(context: Context): Boolean {
    return ContextCompat.checkSelfPermission(
      context, Manifest.permission.ACCESS_FINE_LOCATION
    ) == PackageManager.PERMISSION_GRANTED
  }

  private fun CellInfo.toMap(): Map<String, Any?>? = when (this) {
    is CellInfoLte -> {
      val id = cellIdentity
      val s = cellSignalStrength
      mapOf(
        "type" to "LTE",
        "mcc" to mccOrNull(id.mccString, @Suppress("DEPRECATION") id.mcc),
        "mnc" to mccOrNull(id.mncString, @Suppress("DEPRECATION") id.mnc),
        "lac" to id.tac.orNullIfInvalid(),
        "cid" to id.ci.orNullIfInvalid(),
        "pci" to id.pci.orNullIfInvalid(),
        "rssi" to if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) s.rssi.dbmOrNull() else s.dbm.dbmOrNull(),
        "signalDbm" to s.dbm.dbmOrNull(),
        // Ground truth from the modem — `true` iff the cell is part of the
        // device's current registration (primary LTE, or the NR leg of 5G
        // NSA). Backend uses this to pick the serving cell; signal strength
        // is only a fallback for when no cell reports it (e.g. iOS, mock).
        "isRegistered" to isRegistered,
      )
    }
    is CellInfoGsm -> {
      val id = cellIdentity
      val s = cellSignalStrength
      mapOf(
        "type" to "GSM",
        "mcc" to mccOrNull(id.mccString, @Suppress("DEPRECATION") id.mcc),
        "mnc" to mccOrNull(id.mncString, @Suppress("DEPRECATION") id.mnc),
        "lac" to id.lac.orNullIfInvalid(),
        "cid" to id.cid.orNullIfInvalid(),
        "pci" to null,
        "rssi" to s.dbm.dbmOrNull(),
        "signalDbm" to s.dbm.dbmOrNull(),
        "isRegistered" to isRegistered,
      )
    }
    is CellInfoWcdma -> {
      val id = cellIdentity
      val s = cellSignalStrength
      mapOf(
        "type" to "WCDMA",
        "mcc" to mccOrNull(id.mccString, @Suppress("DEPRECATION") id.mcc),
        "mnc" to mccOrNull(id.mncString, @Suppress("DEPRECATION") id.mnc),
        "lac" to id.lac.orNullIfInvalid(),
        "cid" to id.cid.orNullIfInvalid(),
        "pci" to id.psc.orNullIfInvalid(),
        // getDbm() = RSCP for WCDMA. Many modems don't measure it and report
        // the AOSP ceiling (WCDMA_RSCP_MAX = -24) as a "no data" sentinel —
        // which then masquerades as the strongest possible signal and wins
        // serving-cell selection. Reject it: real RSCP is <= ~-40.
        "rssi" to s.dbm.wcdmaDbmOrNull(),
        "signalDbm" to s.dbm.wcdmaDbmOrNull(),
        "isRegistered" to isRegistered,
      )
    }
    is CellInfoNr -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val id = cellIdentity as CellIdentityNr
      val s = cellSignalStrength as CellSignalStrengthNr
      mapOf(
        "type" to "NR",
        "mcc" to id.mccString?.toIntOrNull(),
        "mnc" to id.mncString?.toIntOrNull(),
        "lac" to id.tac.orNullIfInvalid(),
        // NCI is a 36-bit long; Int.MAX_VALUE is ample for demo purposes
        // but will truncate high bits for some 5G networks.
        "cid" to id.nci.takeIf { it != Long.MAX_VALUE }?.toInt(),
        "pci" to id.pci.orNullIfInvalid(),
        "rssi" to s.dbm.dbmOrNull(),
        "signalDbm" to s.dbm.dbmOrNull(),
        "isRegistered" to isRegistered,
      )
    } else null
    else -> null
  }

  private fun mccOrNull(mccString: String?, legacy: Int): Int? {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      mccString?.toIntOrNull()?.let { return it }
    }
    return legacy.orNullIfInvalid()
  }

  private fun Int.orNullIfInvalid(): Int? =
    if (this == Int.MAX_VALUE || this <= 0) null else this

  // dBm signal values are always negative on real modems. Android returns
  // Int.MAX_VALUE (CellInfo.UNAVAILABLE) for neighbour cells whose signal
  // hasn't been measured, or for fields the current radio doesn't populate.
  // Plausible window: GSM −113…−51, LTE RSRP −140…−44, NR RSRP −156…−31.
  // We keep the window loose so future radios still pass.
  private fun Int.dbmOrNull(): Int? =
    if (this == Int.MAX_VALUE || this >= 0 || this < -160) null else this

  // WCDMA-only: also reject the RSCP ceiling sentinel (>= -25, i.e. the AOSP
  // WCDMA_RSCP_MAX = -24 returned when the modem reports no real RSCP). Real
  // RSCP is always <= ~-40, so this never drops a genuine reading.
  private fun Int.wcdmaDbmOrNull(): Int? =
    if (this >= -25) null else this.dbmOrNull()
}
