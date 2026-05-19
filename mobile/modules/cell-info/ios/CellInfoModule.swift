import ExpoModulesCore

/**
 * iOS stub. Apple does not expose serving/neighbour cell identifiers to
 * third-party apps (only the carrier name via `CTCarrier`, which itself
 * is deprecated in iOS 16+). This module always returns an empty list so
 * the JS side can fall back to an empty cell-tower payload.
 */
public class CellInfoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("CellInfoModule")

    AsyncFunction("getCellInfo") { () -> [[String: Any?]] in
      return []
    }
  }
}
