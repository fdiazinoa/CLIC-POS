# Inventario de fuentes inspeccionadas

2026-09-16, develop `669f9624c85de40129169e6779aa6983f1441fea`: 1055 archivos enumerados y 818 fuentes escaneadas. Lectura profunda de rutas críticas y delta desde auditoría anterior; no auditoría semántica de todas las líneas. Imports extraídos estáticamente, no grafo runtime completo. No se reproducen secretos/dumps/cliente.

| Archivo | Líneas | Imports estáticos |
|---|---:|---|
| `.codex/scripts/workflow-gate.mjs` | 141 | `node:child_process`, `node:fs`, `node:path`, `node:url` |
| `.codex/scripts/workflow-gate.test.mjs` | 61 | `./workflow-gate.mjs`, `node:assert/strict`, `node:fs`, `node:os`, `node:path`, `node:test` |
| `App.tsx` | 13537 | `./components/ActivationScreen`, `./components/AutomaticRecoveryDialog`, `./components/CustomerVisor`, `./components/ErrorBoundary`, `./components/GlobalVirtualKeyboard`, `./components/InventoryTracking`, `./components/LoginScreen`, `./components/ModernLoginScreen`, `./components/POSInterface`, `./components/PosApkUpdateBanner`, `./components/RecoveryCloseDialog`, `./components/SetupWizard`, `./components/SyncErrorDiagnosticModal`, `./components/TableLayoutDesigner`, `./components/TableMap`, `./components/TerminalBindingScreen`, `./components/TerminalModeSelector`, `./components/ThemeContext`, `./components/VerticalSelector`, `./components/inventory/InventoryAuditClosure`, `./components/inventory/InventoryCount`, `./components/inventory/InventoryHome`, `./components/inventory/InventoryLabelsMobile`, `./components/inventory/MobileReception`, `./components/kds/KitchenDisplay`, `./components/kiosk/KioskContext`, `./components/kiosk/KioskPayment`, `./components/kiosk/KioskProductBrowser`, `./components/kiosk/KioskWelcome`, `./components/layouts/HandheldLayout`, `./components/layouts/KitchenDisplayLayout`, `./components/layouts/PriceCheckerLayout`, `./components/layouts/SelfCheckoutLayout`, `./components/layouts/StandardPOSLayout`, `./components/price-checker/PriceCheckerDisplay`, `./constants`, `./hooks/useBarcodeScanner`, `./hooks/useKioskMode`, `./hooks/useOfflineInventoryCountSync`, `./services/CheckoutDiagnostics`, `./services/auth/AuthLevelService`, `./services/currency/CurrencyService`, `./services/db`, `./services/email/zReportEmailService`, `./services/fiscal/fiscalService`, `./services/localRefundPersistence`, `./services/network/httpClient`, `./services/payments/AzulMcmService`, `./services/payments/IngenicoAzulWebApiService`, `./services/payments/PaymentIntentService`, `./services/printer/NativePrintBridge`, `./services/printer/OfflinePrintQueueService`, `./services/printer/ThermalPrinterService`, `./services/recovery/NativeZReport`, `./services/recovery/PendingOperationsRecovery`, `./services/recovery/RecoveryCloseController`, `./services/recovery/RecoveryRuntime`, `./services/refunds/erpRefundSource`, `./services/routing/TerminalRouter`, `./services/setup/erpTerminalSetup`, `./services/sync/AdaptivePollingScheduler`, `./services/sync/ApiSyncAdapter`, `./services/sync/AuthenticatedActivityTracker`, `./services/sync/BackgroundSyncManager`, `./services/sync/ClosedTransactionMembership`, `./services/sync/CustomerSyncQueue`, `./services/sync/DurableOutboxRepository`, `./services/sync/InventorySyncService`, `./services/sync/MasterNumberRangeService`, `./services/sync/PermissionService`, `./services/sync/PosCloudStagingService`, `./services/sync/PosUserSyncQueue`, `./services/sync/ProductImageCacheService`, `./services/sync/RealtimeNotificationService`, `./services/sync/SalePostedContract`, `./services/sync/SeriesSyncService`, `./services/sync/SyncErrorDiagnostic`, `./services/sync/SyncFeatureFlags`, `./services/sync/SyncManager`, `./services/sync/SyncMetrics`, `./services/sync/SyncProfile`, `./services/sync/SyncTriggerCoordinator`, `./services/sync/TerminalConfigRequestCoordinator`, `./services/sync/TerminalCredentialStore`, `./services/sync/TransactionSyncService`, `./services/sync/customerIdentityContract`, `./services/sync/deviceToken`, `./services/sync/erpRegisterResponse`, `./services/sync/masterCustomerReconciliation`, `./services/sync/terminalIdentity`, `./services/transactionService`, `./services/version/posApkUpdateService`, `./services/zreports/ZReportSequenceContinuity`, `./styles/high-contrast.css`, `./types`, `./utils/analytics`, `./utils/backgroundSyncScheduler`, `./utils/barcodeParser`, `./utils/closeReceiptSummary`, `./utils/closeReportOptions`, `./utils/cloudMasterRegistry`, `./utils/couponService`, `./utils/customerDisplay`, `./utils/db`, `./utils/deviceRevocation`, `./utils/deviceRoleHelpers`, `./utils/documentSeriesIdentity`, `./utils/entityImage`, `./utils/erpBaseUrl`, `./utils/erpFiscalCatalogSync`, `./utils/erpHeartbeatScheduler`, `./utils/erpPaymentMethods`, `./utils/erpSyncLifecycle`, `./utils/fiscal/fiscalHelpers`, `./utils/fiscalBreakdown`, `./utils/interactionPerformance`, `./utils/inventoryEngine`, `./utils/labelPrinter`, `./utils/licenseGuard`, `./utils/masterLanDiscovery`, `./utils/masterOperationalApi`, `./utils/masterServerEligibility`, `./utils/nativeSessionResume`, `./utils/operatorUiTransition`, `./utils/orderServiceType`, `./utils/orderTakerPolicy`, `./utils/posCatalogDebugTrace`, `./utils/posMasterCatalogContract`, `./utils/posSaleActivity`, `./utils/posStartupView`, `./utils/posUserReconciliation`, `./utils/printer`, `./utils/productionRoutingAssignment`, `./utils/promotionEngine`, `./utils/refundAvailability`, `./utils/restaurantHotReversal`, `./utils/startupTrace`, `./utils/supabase`, `./utils/syncInactivityPolicy`, `./utils/tableLayout`, `./utils/tableTicketIntegrity`, `./utils/taxSummary`, `./utils/terminalAuthorizationGuard`, `./utils/terminalConfigPushScopes`, `./utils/terminalConfigSnapshot`, `./utils/terminalLoginLabel`, `./utils/visorSync`, `./utils/zReportPaymentSummary`, `@capacitor/core`, `lucide-react`, `react`, `uuid` |
| `android/app/build.gradle` | 122 | — |
| `android/app/capacitor.build.gradle` | 21 | — |
| `android/app/src/androidTest/java/com/getcapacitor/myapp/ExampleInstrumentedTest.java` | 26 | — |
| `android/app/src/main/java/com/clicpos/app/MainActivity.java` | 331 | — |
| `android/app/src/main/java/com/clicpos/app/NoExtractCapacitorWebView.java` | 26 | — |
| `android/app/src/main/java/com/clicpos/app/PosDiagnosticSink.java` | 13 | — |
| `android/app/src/main/java/com/clicpos/app/PosNativeDiagnostics.java` | 54 | — |
| `android/app/src/test/java/com/getcapacitor/myapp/ExampleUnitTest.java` | 18 | — |
| `android/build.gradle` | 30 | — |
| `android/capacitor.settings.gradle` | 12 | — |
| `android/diagnostics/PosDiagnosticHooks.java` | 53 | — |
| `android/settings.gradle` | 5 | — |
| `android/variables.gradle` | 18 | — |
| `bootstrap.tsx` | 21 | `./App`, `./components/system/ClicDialogHost`, `./index.css`, `./services/dialog/ClicDialogService`, `react`, `react-dom/client` |
| `capacitor.config.ts` | 17 | `@capacitor/cli` |
| `check_terminals.js` | 10 | — |
| `check_terminals.ts` | 4 | `better-sqlite3` |
| `components/AccessibilityToggle.tsx` | 32 | `./ThemeContext`, `lucide-react`, `react` |
| `components/AccountReceivableModal.tsx` | 561 | `../hooks/useCreditControl`, `../types`, `../utils/db`, `../utils/paymentSettlement`, `lucide-react`, `react` |
| `components/ActionButtonsGrid.tsx` | 259 | `../types`, `lucide-react`, `react` |
| `components/ActionFooter.tsx` | 109 | `../types`, `lucide-react`, `react` |
| `components/ActionGrid.tsx` | 148 | `../types`, `lucide-react`, `react` |
| `components/ActivationScreen.tsx` | 881 | `../services/setup/activationTenantIdentity`, `../utils/licenseGuard`, `../utils/supabase`, `lucide-react`, `react` |
| `components/ActivityLog.tsx` | 229 | `lucide-react`, `react` |
| `components/ActivityModal.tsx` | 988 | `../services/AgendaService`, `../types`, `../utils/db`, `date-fns`, `lucide-react`, `react` |
| `components/ActivityTooltip.tsx` | 97 | `../types`, `date-fns`, `framer-motion`, `lucide-react`, `react` |
| `components/AdvancedCalendar.tsx` | 275 | `../types`, `date-fns`, `date-fns/locale`, `lucide-react`, `react` |
| `components/AgendaManager.tsx` | 497 | `../services/AgendaService`, `../types`, `./ActivityModal`, `./AdvancedCalendar`, `./PipelineKanban`, `./ServiceTypeManager`, `./SpaceTimelineView`, `./TeamTimelineView`, `date-fns`, `lucide-react`, `react` |
| `components/AnalyticsLogic.ts` | 725 | `../types` |
| `components/AndroidNumericKeypadDialog.tsx` | 45 | `./NumericKeypad`, `lucide-react`, `react` |
| `components/AuditLogViewer.tsx` | 142 | `../types`, `lucide-react`, `react` |
| `components/AutomaticRecoveryDialog.tsx` | 24 | `../services/recovery/recoveryService`, `react` |
| `components/AzulSettlementModal.tsx` | 215 | `../services/payments/AzulMcmService`, `../services/payments/IngenicoAzulWebApiService`, `../types`, `lucide-react`, `react` |
| `components/BarcodeScannerModal.tsx` | 342 | `../utils/cameraSelection`, `html5-qrcode`, `lucide-react`, `react` |
| `components/BehaviorSettings.tsx` | 194 | `../types`, `lucide-react`, `react` |
| `components/BulkEditModal.tsx` | 442 | `../types`, `../utils/units`, `lucide-react`, `react` |
| `components/CalendarEvent.tsx` | 100 | `../types`, `date-fns`, `lucide-react`, `react` |
| `components/CartItemOptionsModal.tsx` | 437 | `../types`, `../utils/cartQuantity`, `../utils/terminalSnapshotSellers`, `./NumericKeypad`, `@capacitor/core`, `lucide-react`, `react` |
| `components/CatalogManager.tsx` | 2189 | `../hooks/useBarcodeScanner`, `../services/sync/MasterNumberRangeService`, `../services/sync/PermissionService`, `../services/sync/SyncManager`, `../services/sync/saveLocalCatalog`, `../types`, `../utils/db`, `../utils/entityImage`, `../utils/inventoryEngine`, `../utils/masterIdentity`, `../utils/productEditorSync`, `../utils/productReferences`, `./BulkEditModal`, `./ClassificationManager`, `./ErrorBoundary`, `./GroupForm`, `./ProductForm`, `./SeasonForm`, `./TariffForm`, `./VariantManager`, `./WatchlistMonitor`, `lucide-react`, `react` |
| `components/CheckoutTrackingSettings.tsx` | 77 | `../services/CheckoutDiagnostics`, `../services/CheckoutPerformanceDiagnostics`, `../services/sync/TerminalCredentialStore`, `../services/version/posApkUpdateService`, `../types`, `../utils/ExportUtils`, `@capacitor/core`, `@capacitor/filesystem`, `react` |
| `components/ClassificationManager.tsx` | 603 | `../services/sync/SyncManager`, `../services/sync/saveLocalCatalog`, `../types`, `../utils/db`, `../utils/posCatalogPresentation`, `../utils/uuid`, `lucide-react`, `react` |
| `components/CompanySettings.tsx` | 294 | `../types`, `../utils/fiscal/fiscalHelpers`, `lucide-react`, `react` |
| `components/ConversionHelper.tsx` | 124 | `../utils/unitConversions`, `lucide-react`, `react` |
| `components/CouponManager.tsx` | 363 | `../types`, `../utils/couponService`, `lucide-react`, `react` |
| `components/CreditAccountDashboard.tsx` | 346 | `../types`, `./CustomerStatementView`, `lucide-react`, `react` |
| `components/CurrencySettings.tsx` | 807 | `../services/currency/CurrencyService`, `../services/sync/ApiSyncAdapter`, `../services/sync/SyncProfile`, `../types`, `lucide-react`, `react` |
| `components/CustomerManagement.tsx` | 2375 | `../services/AgendaService`, `../services/customers/customerPresentation`, `../services/dgii/DGIIValidationService`, `../types`, `../utils/entityImage`, `../utils/fiscal/fiscalHelpers`, `../utils/fiscalBreakdown`, `../utils/paymentSettlement`, `../utils/printer`, `../utils/uuid`, `./AccountReceivableModal`, `./ActivityModal`, `./CreditAccountDashboard`, `./FiscalSyncBadge`, `./LoyaltyDashboard`, `lucide-react`, `react` |
| `components/CustomerStatementView.tsx` | 235 | `../services/printer/BrowserPrint`, `../types`, `./ProfessionalAccountStatement`, `lucide-react`, `react` |
| `components/CustomerVisor.tsx` | 212 | `../utils/visorSync`, `lucide-react`, `react` |
| `components/DataSecurityHub.tsx` | 416 | `../services/db`, `../types`, `../utils/ExportUtils`, `../utils/db`, `./FactoryResetModal`, `lucide-react`, `react` |
| `components/DocumentSettings.tsx` | 2287 | `../constants`, `../services/fiscal/fiscalService`, `../services/sync/SeriesSyncService`, `../services/sync/SyncManager`, `../types`, `../utils/db`, `../utils/documentSeriesIdentity`, `../utils/fiscal/fiscalHelpers`, `lucide-react`, `react` |
| `components/EmailPreviewModal.tsx` | 235 | `lucide-react`, `react` |
| `components/EmailSettings.tsx` | 214 | `../types`, `../utils/erpBaseUrl`, `lucide-react`, `react` |
| `components/ErrorBoundary.tsx` | 60 | `lucide-react`, `react` |
| `components/FactoryResetModal.tsx` | 362 | `lucide-react`, `react` |
| `components/FinanceDashboard.tsx` | 620 | `../types`, `lucide-react`, `react` |
| `components/FiscalSyncBadge.tsx` | 82 | `../types`, `../utils/fiscal/fiscalHelpers`, `lucide-react`, `react` |
| `components/FranchiseDashboard.tsx` | 580 | `lucide-react`, `react` |
| `components/GlobalDiscountModal.tsx` | 173 | `./NumericKeypad`, `@capacitor/core`, `lucide-react`, `react` |
| `components/GlobalVirtualKeyboard.tsx` | 149 | `./VirtualKeyboard`, `@capacitor/core`, `react` |
| `components/GroupForm.tsx` | 330 | `../types`, `lucide-react`, `react` |
| `components/HardwareSettings.tsx` | 1738 | `../services/BiometricAuthService`, `../services/printer/EscPosFormatter`, `../services/printer/NativePrintBridge`, `../types`, `../utils/barcodeParser`, `../utils/customerDisplay`, `../utils/media`, `lucide-react`, `react` |
| `components/IconOnlyActionGrid.tsx` | 118 | `../types`, `lucide-react`, `react` |
| `components/ImportWizard/ImportWizard.tsx` | 157 | `../../types`, `../../types/importExport`, `../../utils/importParser`, `./Step1Config`, `./Step2Mapping`, `./Step3Preview`, `./Step4Processing`, `lucide-react`, `react` |
| `components/ImportWizard/Step1Config.tsx` | 152 | `../../constants/importFields`, `../../types/importExport`, `lucide-react`, `react` |
| `components/ImportWizard/Step2Mapping.tsx` | 131 | `../../constants/importFields`, `lucide-react`, `react` |
| `components/ImportWizard/Step3Preview.tsx` | 76 | `../../constants/importFields`, `react` |
| `components/ImportWizard/Step4Processing.tsx` | 372 | `../../constants/importFields`, `../../types`, `../../types/importExport`, `../../utils/uuid`, `lucide-react`, `react` |
| `components/IntegrationAuditModal.tsx` | 262 | `../types`, `lucide-react`, `react` |
| `components/IntegrationSettings.tsx` | 973 | `../services/payments/AzulMcmService`, `../services/payments/IngenicoAzulWebApiService`, `../services/payments/paymentIntegrationAudit`, `../types`, `../utils/printer`, `./AzulSettlementModal`, `./IntegrationAuditModal`, `lucide-react`, `react` |
| `components/InventoryAudit.tsx` | 444 | `../types`, `lucide-react`, `react` |
| `components/InventoryOptimizer.tsx` | 520 | `../services/sync/SyncManager`, `../types`, `../utils/db`, `lucide-react`, `react` |
| `components/InventoryTracking.tsx` | 369 | `lucide-react`, `react` |
| `components/LabelDesigner.tsx` | 732 | `../constants`, `../types`, `lucide-react`, `react` |
| `components/LabelPrintModal.tsx` | 361 | `../constants`, `../types`, `../utils/labelPrinter`, `lucide-react`, `react` |
| `components/LoginScreen.tsx` | 456 | `../services/BiometricAuthService`, `../types`, `../utils/interactionPerformance`, `./AccessibilityToggle`, `@capacitor/core`, `lucide-react`, `react` |
| `components/LoyaltyDashboard.tsx` | 207 | `../types`, `lucide-react`, `react` |
| `components/LoyaltyScanModal.tsx` | 68 | `lucide-react`, `react` |
| `components/LoyaltySettings.tsx` | 202 | `../types`, `./EmailPreviewModal`, `lucide-react`, `react` |
| `components/MasterNumberRangeDiagnostics.tsx` | 98 | `../services/sync/MasterNumberRangeService`, `../services/sync/masterNumberRangeContract`, `lucide-react`, `react` |
| `components/MobileCartButton.tsx` | 46 | `lucide-react`, `react` |
| `components/MobileConfigModal.tsx` | 174 | `../types`, `lucide-react`, `react` |
| `components/MobilePosNavigation.tsx` | 23 | `lucide-react`, `react` |
| `components/ModernActionFooter.tsx` | 121 | `../types`, `lucide-react`, `react` |
| `components/ModernLoginScreen.tsx` | 462 | `../services/BiometricAuthService`, `../types`, `../utils/interactionPerformance`, `./ModernLoginScreen.css`, `@capacitor/core`, `lucide-react`, `react` |
| `components/ModifierModal.tsx` | 475 | `../types`, `../utils/restaurantProductConfig`, `lucide-react`, `react` |
| `components/N8nSettings.tsx` | 148 | `../types`, `lucide-react`, `react` |
| `components/NumericKeypad.tsx` | 55 | `../utils/numericInput`, `lucide-react`, `react` |
| `components/OrderMatrixModal.tsx` | 231 | `../types`, `lucide-react`, `react` |
| `components/OrderServiceTypeButton.tsx` | 15 | `../types`, `lucide-react`, `react` |
| `components/OrderServiceTypeDialog.tsx` | 49 | `../types`, `lucide-react`, `react` |
| `components/POSInterface.tsx` | 9754 | `../hooks/useBottomSafeOffset`, `../hooks/useIsMobile`, `../hooks/useSupervisorAuth`, `../services/CheckoutDiagnostics`, `../services/localRefundPersistence`, `../services/network/httpClient`, `../services/sync/BackgroundSyncManager`, `../services/sync/ConsignmentSyncService`, `../services/sync/SyncFeatureFlags`, `../services/sync/SyncManager`, `../services/transactionService`, `../services/uberEatsPosService`, `../types`, `../utils/barcodeParser`, `../utils/cameraCapability`, `../utils/cartItemEditPermissions`, `../utils/cartQuantity`, `../utils/couponScan`, `../utils/couponService`, `../utils/creditRules`, `../utils/customerDisplay`, `../utils/db`, `../utils/deviceProfile`, `../utils/deviceRoleHelpers`, `../utils/entityImage`, `../utils/fiscal/fiscalHelpers`, `../utils/fiscalBreakdown`, `../utils/format`, `../utils/globalBarcodeCapture`, `../utils/interactionPerformance`, `../utils/inventoryEngine`, `../utils/kdsRouting`, `../utils/loyaltyEngine`, `../utils/masterIdentity`, `../utils/masterOperationalApi`, `../utils/orderServiceType`, `../utils/paymentFractions`, `../utils/paymentSettlement`, `../utils/posCatalogPresentation`, `../utils/posCategoryGrid`, `../utils/posTableHeader`, `../utils/printer`, `../utils/productReferences`, `../utils/productionOutputMode`, `../utils/productionRoutingAssignment`, `../utils/promotionEngine`, `../utils/restaurantHotReversal`, `../utils/restaurantNavigation`, `../utils/restaurantProductConfig`, `../utils/seriesValidation`, `../utils/serviceTaxPolicy`, `../utils/session`, `../utils/taxSummary`, `../utils/terminalSnapshotSellers`, `../utils/userSalesPolicy`, `../utils/validation`, `../utils/variantSalesPrice`, `../utils/visorSync`, `./ActionGrid`, `./BarcodeScannerModal`, `./CartItemOptionsModal`, `./GlobalDiscountModal`, `./LoyaltyScanModal`, `./MobileCartButton`, `./MobileConfigModal`, `./MobilePosNavigation`, `./ModifierModal`, `./NumericKeypad`, `./OrderServiceTypeButton`, `./OrderServiceTypeDialog`, `./PaymentModal`, `./ProductQuickActions`, `./ProductTableSupermarket`, `./ProductVariantSelector`, `./ProductionRoutingAssignmentModal`, `./PromoBottomSheet`, `./ReturnModal`, `./SafetyGateModal`, `./ScaleModal`, `./SplitTicketModal`, `./SupermarketTicketSummary`, `./SupervisorAuthModal`, `./SupervisorModal`, `./TicketOptionsModal`, `./TrackingSelectionModal`, `./VirtualKeyboard`, `@capacitor/core`, `html5-qrcode`, `lucide-react`, `react` |
| `components/PaymentModal.tsx` | 1637 | `../services/CheckoutDiagnostics`, `../services/email/receiptEmailPayload`, `../services/email/receiptEmailService`, `../services/payments/AzulMcmService`, `../services/payments/IngenicoAzulWebApiService`, `../services/payments/PaymentIntentService`, `../services/payments/paymentIntegrationAudit`, `../services/sync/NetworkSyncService`, `../types`, `../utils/creditRules`, `../utils/erpPaymentMethods`, `../utils/interactionPerformance`, `../utils/loyaltyEngine`, `../utils/paymentSettlement`, `../utils/printer`, `./SupervisorAuthModal`, `lucide-react`, `react` |
| `components/PaymentSettings.tsx` | 580 | `../types`, `lucide-react`, `react` |
| `components/PendingOperationsRecoveryPanel.tsx` | 144 | `../services/db`, `../services/recovery/RecoveryRuntime`, `../services/recovery/recoveryService`, `../services/sync/SyncFeatureFlags`, `react` |
| `components/PipelineKanban.tsx` | 268 | `../types`, `lucide-react`, `react` |
| `components/PosApkUpdateBanner.tsx` | 76 | `../services/version/posApkUpdateService`, `lucide-react`, `react` |
| `components/PrintCopiesStepper.tsx` | 41 | `../utils/printCopies`, `lucide-react`, `react` |
| `components/ProductActionModal.tsx` | 279 | `../types`, `../utils/db`, `../utils/promotionEngine`, `./NumericKeypad`, `@capacitor/core`, `lucide-react`, `react` |
| `components/ProductForm.tsx` | 4446 | `../services/sync/InventorySyncService`, `../services/sync/PermissionService`, `../types`, `../utils/categoryOptions`, `../utils/db`, `../utils/inventoryEngine`, `../utils/masterIdentity`, `../utils/media`, `../utils/productEditorSummary`, `../utils/productEditorSync`, `../utils/productEditorTabs`, `../utils/productReferences`, `../utils/restaurantProductConfig`, `../utils/taxIdentity`, `../utils/units`, `../utils/uuid`, `./ConversionHelper`, `./LabelPrintModal`, `./ProductionAreaManager`, `./ProfitCalculator`, `./RecipeManager`, `./UnitSelector`, `./product-editor/ProductEditorChrome`, `@capacitor/core`, `lucide-react`, `react` |
| `components/ProductQuickActions.tsx` | 441 | `../types`, `../utils/db`, `../utils/masterIdentity`, `./NumericKeypad`, `@capacitor/core`, `lucide-react`, `react` |
| `components/ProductTableSupermarket.tsx` | 145 | `../types`, `./supermarketTicket.css`, `lucide-react`, `react` |
| `components/ProductVariantSelector.tsx` | 305 | `../types`, `../utils/variantSalesPrice`, `lucide-react`, `react` |
| `components/ProductionAreaManager.tsx` | 774 | `../types`, `../utils/db`, `../utils/kdsRouting`, `../utils/restaurantProductConfig`, `lucide-react`, `react` |
| `components/ProductionRoutingAssignmentModal.tsx` | 144 | `lucide-react`, `react` |
| `components/ProfessionalAccountStatement.tsx` | 327 | `../types`, `../utils/collectionSettlement`, `../utils/paymentSettlement`, `lucide-react`, `react` |
| `components/ProfitCalculator.tsx` | 252 | `lucide-react`, `react` |
| `components/PromoBottomSheet.tsx` | 134 | `../types`, `lucide-react`, `react` |
| `components/PromotionBuilder.tsx` | 909 | `../types`, `../utils/media`, `../utils/promotionAnalytics`, `./CouponManager`, `lucide-react`, `react` |
| `components/PurchaseOrderList.tsx` | 176 | `../types`, `../utils/dateUtils`, `lucide-react`, `react` |
| `components/RNCValidationWidget.tsx` | 154 | `../services/dgii/DGIIValidationService`, `../types`, `lucide-react`, `react` |
| `components/ReceiptDesigner.tsx` | 430 | `../types`, `../utils/printCopies`, `../utils/receiptVariant`, `./PrintCopiesStepper`, `lucide-react`, `react` |
| `components/ReceptionHistory.tsx` | 279 | `../types`, `../utils/dateUtils`, `./LabelPrintModal`, `lucide-react`, `react` |
| `components/RecipeManager.tsx` | 422 | `../types`, `../utils/pricing`, `../utils/units`, `../utils/uuid`, `lucide-react`, `react` |
| `components/RecoveryCloseDialog.tsx` | 274 | `../services/recovery/RecoveryCloseController`, `../services/recovery/recoveryService`, `react` |
| `components/RefundModal.tsx` | 329 | `../types`, `../utils/refundAvailability`, `lucide-react`, `react` |
| `components/ReportDashboard.tsx` | 101 | `../types`, `lucide-react`, `react` |
| `components/ReportViewer.tsx` | 2720 | `../hooks/useCustomerAnalytics`, `../services/printer/BrowserPrint`, `../types`, `../utils/fiscalExcel`, `../utils/paymentSettlement`, `./AnalyticsLogic`, `lucide-react`, `react` |
| `components/ReturnModal.tsx` | 257 | `../services/transactionService`, `../types`, `lucide-react`, `react` |
| `components/SafetyGateModal.tsx` | 79 | `lucide-react`, `react` |
| `components/ScaleModal.tsx` | 156 | `../types`, `lucide-react`, `react` |
| `components/SeasonForm.tsx` | 407 | `../types`, `lucide-react`, `react` |
| `components/ServiceTaxPolicyEditor.tsx` | 159 | `../types`, `lucide-react`, `react` |
| `components/ServiceTypeManager.tsx` | 556 | `../services/AgendaService`, `../types`, `lucide-react`, `react`, `uuid` |
| `components/ServiceTypeSettings.tsx` | 97 | `../types`, `../utils/serviceTaxPolicy`, `./ServiceTaxPolicyEditor`, `lucide-react`, `react` |
| `components/Settings.tsx` | 1157 | `../services/sync/MasterNumberRangeService`, `../services/version/posApkUpdateService`, `../types`, `../utils/deviceRoleHelpers`, `./AnalyticsLogic`, `./CheckoutTrackingSettings`, `lucide-react`, `react` |
| `components/SettingsOperational.tsx` | 584 | `lucide-react`, `react` |
| `components/SetupWizard.tsx` | 1583 | `../constants`, `../types`, `../utils/db`, `../utils/deviceProfile`, `../utils/deviceRoleHelpers`, `../utils/productSeedPacks`, `lucide-react`, `react` |
| `components/SmartReplenishment.tsx` | 581 | `../services/sync/SyncManager`, `../types`, `../utils/db`, `lucide-react`, `react` |
| `components/SolidFlatActionFooter.tsx` | 145 | `../types`, `lucide-react`, `react` |
| `components/SourcingIntelligence.tsx` | 410 | `../services/printer/BrowserPrint`, `../types`, `../utils/dateUtils`, `./AnalyticsLogic`, `lucide-react`, `react` |
| `components/SpaceForm.tsx` | 151 | `../types`, `../utils/uuid`, `lucide-react`, `react` |
| `components/SpaceTimelineView.tsx` | 181 | `../types`, `date-fns`, `date-fns/locale`, `lucide-react`, `react` |
| `components/SpacesManager.tsx` | 306 | `../types`, `../utils/db`, `lucide-react`, `react`, `uuid` |
| `components/SplitTicketModal.tsx` | 369 | `../types`, `lucide-react`, `react` |
| `components/SupermarketTicketSummary.tsx` | 33 | `react` |
| `components/SupervisorAuthModal.tsx` | 181 | `../types`, `lucide-react`, `react` |
| `components/SupervisorModal.tsx` | 163 | `../types`, `../utils/userSalesPolicy`, `lucide-react`, `react` |
| `components/SupplierSelector.tsx` | 252 | `../types`, `../utils/uuid`, `lucide-react`, `react` |
| `components/SupplyChainManager.tsx` | 1587 | `../services/sync/SyncManager`, `../types`, `../utils/dateUtils`, `../utils/db`, `../utils/entityImage`, `../utils/uuid`, `../utils/validation`, `./ErrorBoundary`, `./InventoryAudit`, `./OrderMatrixModal`, `./PurchaseOrderList`, `./ReceptionHistory`, `./SupplierSelector`, `lucide-react`, `react` |
| `components/SyncErrorDiagnosticModal.tsx` | 773 | `../services/network/httpClient`, `../services/sync/SyncErrorDiagnostic`, `../services/sync/TerminalCredentialStore`, `../services/sync/deviceToken`, `lucide-react`, `react` |
| `components/SyncProgressModal.tsx` | 95 | `lucide-react`, `react` |
| `components/SyncSettings.tsx` | 1830 | `../services/db`, `../services/sync/BackgroundSyncManager`, `../services/sync/PermissionService`, `../services/sync/PosCloudStagingService`, `../services/sync/SyncManager`, `../services/sync/SyncProfile`, `../services/sync/SyncTriggerCoordinator`, `../services/sync/catalogEdits`, `../types`, `../utils/backgroundSyncScheduler`, `../utils/db`, `../utils/erpSyncLifecycle`, `./PendingOperationsRecoveryPanel`, `./SyncProgressModal`, `lucide-react`, `react` |
| `components/SyncStatusHub.tsx` | 245 | `lucide-react`, `react` |
| `components/SyncStatusIndicator.tsx` | 173 | `../services/sync/PermissionService`, `../services/sync/SyncManager`, `../services/sync/SyncTriggerCoordinator`, `lucide-react`, `react` |
| `components/TableLayoutDesigner.tsx` | 684 | `../types`, `../utils/tableLayout`, `lucide-react`, `react` |
| `components/TableMap.tsx` | 2814 | `../services/network/httpClient`, `../types`, `../utils/interactionPerformance`, `../utils/kdsPresentation`, `../utils/masterOperationalApi`, `../utils/paymentFractions`, `../utils/tableAccessPolicy`, `../utils/tableAccountPresentation`, `../utils/tableChairs`, `../utils/tableLayout`, `../utils/tableMotionPolicy`, `./SplitTicketModal`, `./TableMoveConfirmationModal`, `./TableOptionsModal`, `@capacitor/core`, `framer-motion`, `lucide-react`, `react` |
| `components/TableMoveConfirmationModal.tsx` | 191 | `../types`, `lucide-react`, `react` |
| `components/TableOptionsModal.tsx` | 283 | `../types`, `lucide-react`, `react` |
| `components/TariffForm.tsx` | 738 | `../services/sync/saveLocalCatalog`, `../types`, `../utils/db`, `../utils/masterIdentity`, `lucide-react`, `react` |
| `components/TaxSettings.tsx` | 358 | `../services/sync/ApiSyncAdapter`, `../services/sync/SyncProfile`, `../types`, `lucide-react`, `react` |
| `components/TeamHub.tsx` | 1028 | `../constants`, `../services/BiometricAuthService`, `../types`, `../utils/teamHubAccess`, `../utils/userSalesPolicy`, `lucide-react`, `react`, `uuid` |
| `components/TeamTimelineView.tsx` | 393 | `../types`, `date-fns`, `date-fns/locale`, `framer-motion`, `lucide-react`, `react` |
| `components/TerminalBindingScreen.tsx` | 618 | `../services/setup/erpTerminalSetup`, `../services/setup/masterPairingConnection`, `../services/sync/SyncProfile`, `../types`, `../utils/cloudMasterRegistry`, `../utils/masterLanDiscovery`, `../utils/masterServerEligibility`, `../utils/orderTakerPolicy`, `./TerminalSelector`, `lucide-react`, `react` |
| `components/TerminalModeSelector.tsx` | 101 | `lucide-react`, `react` |
| `components/TerminalPairingView.tsx` | 554 | `../services/sync/NetworkScanner`, `../types`, `../utils/cloudMasterRegistry`, `lucide-react`, `react` |
| `components/TerminalSelector.tsx` | 2332 | `../services/network/httpClient`, `../services/setup/erpTerminalSetup`, `../services/setup/terminalDeviceRequests`, `../services/sync/MasterNumberRangeService`, `../services/sync/SyncProfile`, `../services/sync/TerminalCredentialStore`, `../services/sync/deviceToken`, `../services/sync/erpRegisterResponse`, `../services/sync/terminalIdentity`, `../types`, `../utils/cloudMasterRegistry`, `../utils/orderTakerPolicy`, `../utils/terminalBindingHierarchy`, `../utils/terminalConfigSnapshot`, `@capacitor/core`, `lucide-react`, `react` |
| `components/TerminalSettings.tsx` | 1167 | `../constants`, `../services/sync/SyncManager`, `../types`, `../utils/closeReportOptions`, `../utils/db`, `../utils/deviceProfile`, `../utils/deviceRoleHelpers`, `../utils/documentSeriesIdentity`, `../utils/seriesValidation`, `./AccessibilityToggle`, `./ServiceTaxPolicyEditor`, `./SettingsOperational`, `@capacitor/core`, `lucide-react`, `react` |
| `components/ThemeContext.tsx` | 42 | `react` |
| `components/TicketContextMenu.tsx` | 70 | `lucide-react`, `react` |
| `components/TicketHistory.tsx` | 2984 | `../hooks/useSupervisorAuth`, `../services/email/receiptEmailPayload`, `../services/email/receiptEmailService`, `../services/invoices/InvoiceReviewService`, `../services/payments/AzulMcmService`, `../services/payments/paymentIntegrationAudit`, `../services/refunds/erpRefundSource`, `../services/sync/ApiSyncAdapter`, `../types`, `../utils/fiscal/fiscalHelpers`, `../utils/fiscalBreakdown`, `../utils/paymentSettlement`, `../utils/printer`, `../utils/refundAvailability`, `../utils/transactionHistoryPresentation`, `../utils/validation`, `./FiscalSyncBadge`, `./RefundModal`, `./SupervisorModal`, `lucide-react`, `react` |
| `components/TicketOptionsModal.tsx` | 147 | `lucide-react`, `react` |
| `components/TipsSettings.tsx` | 343 | `../types`, `lucide-react`, `react` |
| `components/TrackingSelectionModal.tsx` | 216 | `../types`, `../utils/db`, `lucide-react`, `react` |
| `components/UnitSelector.tsx` | 149 | `../types`, `lucide-react`, `react` |
| `components/VariantManager.tsx` | 474 | `../types`, `lucide-react`, `react` |
| `components/VerticalSelector.tsx` | 100 | `../constants`, `../types`, `lucide-react`, `react` |
| `components/VirtualKeyboard.tsx` | 72 | `lucide-react`, `react` |
| `components/WalletIntegrations.tsx` | 341 | `../types`, `lucide-react`, `react` |
| `components/WarehouseManager.tsx` | 1833 | `../services/sync/BackgroundSyncManager`, `../services/sync/TransferReceiptService`, `../types`, `../utils/db`, `../utils/validation`, `./ErrorBoundary`, `./InventoryAudit`, `./InventoryOptimizer`, `./SmartReplenishment`, `./inventory/InventoryAuditClosure`, `lucide-react`, `react` |
| `components/WatchlistAddProductsModal.tsx` | 261 | `../types`, `lucide-react`, `react` |
| `components/WatchlistAlertModal.tsx` | 213 | `../types`, `lucide-react`, `react` |
| `components/WatchlistMonitor.tsx` | 420 | `../types`, `./WatchlistAddProductsModal`, `./WatchlistAlertModal`, `lucide-react`, `react` |
| `components/ZReportDashboard.tsx` | 1021 | `../types`, `../utils/analytics`, `../utils/db`, `../utils/email`, `../utils/orderServiceType`, `../utils/paymentSettlement`, `../utils/zReportPaymentSummary`, `./AndroidNumericKeypadDialog`, `./ZReportHistory`, `@capacitor/core`, `lucide-react`, `react` |
| `components/ZReportHistory.tsx` | 711 | `../services/email/zReportEmailService`, `../services/printer/ThermalPrinterService`, `../services/sync/SyncManager`, `../types`, `../utils/closeReportOptions`, `../utils/db`, `../utils/zReportPaymentSummary`, `lucide-react`, `react` |
| `components/inventory/InventoryAuditClosure.tsx` | 687 | `../../types`, `../../utils/db`, `../../utils/masterIdentity`, `lucide-react`, `react` |
| `components/inventory/InventoryCount.tsx` | 650 | `../../hooks/useOfflineSync`, `../../types`, `../../utils/inventoryProductSearch`, `../../utils/inventoryScanner`, `../BarcodeScannerModal`, `lucide-react`, `react` |
| `components/inventory/InventoryHome.tsx` | 201 | `../../types`, `./WarehouseSelectionModal`, `lucide-react`, `react` |
| `components/inventory/InventoryLabelsMobile.tsx` | 271 | `../../types`, `../BarcodeScannerModal`, `../LabelPrintModal`, `lucide-react`, `react` |
| `components/inventory/MobileReception.tsx` | 770 | `../../hooks/useOfflineSync`, `../../types`, `../../utils/db`, `../BarcodeScannerModal`, `lucide-react`, `react` |
| `components/inventory/WarehouseSelectionModal.tsx` | 88 | `../../types`, `lucide-react`, `react` |
| `components/kds/KitchenDisplay.tsx` | 1061 | `../../utils/kdsPresentation`, `lucide-react`, `react` |
| `components/kiosk/KioskContext.tsx` | 32 | `../../hooks/useKioskSecurity`, `react` |
| `components/kiosk/KioskPayment.tsx` | 737 | `../../services/email/receiptEmailService`, `../../types`, `lucide-react`, `react` |
| `components/kiosk/KioskProductBrowser.tsx` | 1141 | `../../types`, `../../utils/barcodeParser`, `../../utils/db`, `../../utils/entityImage`, `../../utils/masterIdentity`, `../../utils/productReferences`, `../../utils/promotionEngine`, `../PromoBottomSheet`, `./KioskContext`, `./SecurityOverlay`, `lucide-react`, `react` |
| `components/kiosk/KioskWelcome.tsx` | 101 | `lucide-react`, `react` |
| `components/kiosk/SecurityOverlay.tsx` | 256 | `../../hooks/useKioskSecurity`, `lucide-react`, `react` |
| `components/layouts/HandheldLayout.tsx` | 206 | `lucide-react`, `react` |
| `components/layouts/KitchenDisplayLayout.tsx` | 122 | `react` |
| `components/layouts/PriceCheckerLayout.tsx` | 190 | `../../services/auth/AuthLevelService`, `react` |
| `components/layouts/SelfCheckoutLayout.tsx` | 223 | `../../services/auth/AuthLevelService`, `react` |
| `components/layouts/StandardPOSLayout.tsx` | 24 | `react` |
| `components/price-checker/PriceCheckerDisplay.tsx` | 287 | `../../types`, `lucide-react`, `react` |
| `components/product-editor/ProductEditorChrome.tsx` | 118 | `lucide-react`, `react` |
| `components/system/ClicDialogHost.tsx` | 158 | `../../services/dialog/ClicDialogService`, `lucide-react`, `react`, `react-dom` |
| `constants.ts` | 631 | `./types` |
| `constants/importFields.ts` | 81 | — |
| `debug_api.cjs` | 54 | — |
| `debug_api.ts` | 42 | `node-fetch` |
| `diagnostics/runtime.ts` | 147 | `./targeted` |
| `diagnostics/targeted.ts` | 23 | — |
| `diagnostics/viteInstrumentation.ts` | 91 | `typescript`, `vite` |
| `docs/pos-recovery-j3/export-native.cjs` | 11 | — |
| `docs/pos-recovery-j3/verify-bytes.py` | 10 | — |
| `docs/pos-recovery-j3/verify-contract.mjs` | 67 | `../pos-recovery-journal/verify-vectors.mjs`, `node:assert/strict`, `node:fs`, `node:url` |
| `docs/pos-recovery-j4/verify-bytes.py` | 16 | — |
| `docs/pos-recovery-j4/verify-negatives.mjs` | 61 | `../pos-recovery-j3/verify-contract.mjs`, `../pos-recovery-journal/verify-vectors.mjs`, `./verify-semantics.mjs`, `node:assert/strict`, `node:fs` |
| `docs/pos-recovery-j4/verify-semantics.mjs` | 58 | `../pos-recovery-j3/verify-contract.mjs`, `../pos-recovery-journal/verify-vectors.mjs`, `node:assert/strict`, `node:fs`, `node:url` |
| `docs/pos-recovery-j5/verify-all.py` | 29 | — |
| `docs/pos-recovery-j5/verify-regressions.mjs` | 18 | `../pos-recovery-j4/verify-semantics.mjs`, `node:assert/strict`, `node:crypto`, `node:fs` |
| `docs/pos-recovery-j6/verify-review.py` | 30 | — |
| `docs/pos-recovery-j7/verify-evidence.py` | 31 | — |
| `docs/pos-recovery-j8/capture-source.cjs` | 25 | — |
| `docs/pos-recovery-j8/verify-native.cjs` | 41 | — |
| `docs/pos-recovery-j8/verify-review.py` | 30 | — |
| `docs/pos-recovery-j9/capture.cjs` | 20 | — |
| `docs/pos-recovery-j9/verify-native.cjs` | 25 | — |
| `docs/pos-recovery-j9/verify-review.py` | 22 | — |
| `docs/pos-recovery-journal/verify-bytes.py` | 23 | — |
| `docs/pos-recovery-journal/verify-lineage.mjs` | 176 | `./verify-vectors.mjs`, `node:assert/strict`, `node:fs`, `node:url` |
| `docs/pos-recovery-journal/verify-vectors.mjs` | 192 | `node:assert/strict`, `node:crypto`, `node:fs`, `node:url` |
| `docs/pos-recovery-native/verify-pos.cjs` | 70 | — |
| `docs/pos-recovery-native/verify-schema.py` | 35 | — |
| `hooks/useBarcodeScanner.ts` | 31 | `../utils/globalBarcodeCapture`, `react` |
| `hooks/useBottomSafeOffset.ts` | 122 | `react` |
| `hooks/useCreditControl.ts` | 75 | `../types`, `react` |
| `hooks/useCustomerAnalytics.ts` | 290 | `../types`, `react` |
| `hooks/useIsMobile.ts` | 21 | `react` |
| `hooks/useKioskMode.ts` | 39 | `react` |
| `hooks/useKioskSecurity.ts` | 313 | `../types`, `react` |
| `hooks/useLongPress.ts` | 65 | `react` |
| `hooks/useOfflineInventoryCountSync.ts` | 331 | `../services/sync/ApiSyncAdapter`, `../types`, `../utils/db`, `react` |
| `hooks/useOfflineSync.ts` | 441 | `../services/sync/ApiSyncAdapter`, `../types`, `../utils/db`, `react` |
| `hooks/useSupervisorAuth.ts` | 125 | `../types`, `../utils/userSalesPolicy`, `react` |
| `index.tsx` | 6 | — |
| `native-stubs/android/ClicPOSBluetoothPrinterManager.kt` | 385 | — |
| `native-stubs/android/ClicPOSCustomerDisplayBridge.kt` | 386 | — |
| `native-stubs/android/ClicPOSFingerprintEngine.kt` | 61 | — |
| `native-stubs/android/ClicPOSKdsHttpServer.kt` | 434 | — |
| `native-stubs/android/ClicPOSMasterDiscovery.kt` | 212 | — |
| `native-stubs/android/ClicPOSMasterHttpServer.kt` | 1916 | — |
| `native-stubs/android/ClicPOSNativePrinterBridge.kt` | 1767 | — |
| `native-stubs/android/DigitalPersonaUru4500.kt` | 342 | — |
| `native-stubs/electron/main-printer.stub.js` | 101 | — |
| `native-stubs/electron/preload-printer.stub.js` | 37 | — |
| `postcss.config.cjs` | 6 | — |
| `scripts/benchmark-checkout-diagnostics.ts` | 17 | `../services/CheckoutDiagnostics`, `node:perf_hooks` |
| `scripts/build-recovery-oracle.mjs` | 19 | `esbuild`, `node:child_process`, `node:crypto`, `node:fs/promises`, `node:path` |
| `scripts/check_db_state.cjs` | 29 | — |
| `scripts/check_tokens.cjs` | 11 | — |
| `scripts/diagnostics/analyze-calibration-variance.py` | 34 | — |
| `scripts/diagnostics/analyze-selective.py` | 34 | — |
| `scripts/diagnostics/analyze.py` | 39 | — |
| `scripts/diagnostics/annotate.py` | 24 | — |
| `scripts/diagnostics/benchmark-observer.mjs` | 32 | `esbuild`, `node:child_process`, `node:fs`, `node:os`, `node:path` |
| `scripts/diagnostics/calibrate-js.mjs` | 17 | `node:fs` |
| `scripts/diagnostics/capture.py` | 41 | — |
| `scripts/diagnostics/check-reference.mjs` | 17 | `node:fs` |
| `scripts/diagnostics/inspect-transformed.ts` | 16 | `../../diagnostics/viteInstrumentation`, `node:fs`, `node:path` |
| `scripts/diagnostics/measure-table-close.mjs` | 145 | `ws` |
| `scripts/diagnostics/patch-native.py` | 68 | — |
| `scripts/diagnostics/record.py` | 22 | — |
| `scripts/diagnostics/resolve-stacks.mjs` | 8 | `@jridgewell/trace-mapping`, `node:fs`, `node:path` |
| `scripts/diagnostics/sample-js.mjs` | 32 | `node:fs`, `node:path` |
| `scripts/fix_stock_discrepancy.cjs` | 42 | — |
| `scripts/qa/apk-release-gate.mjs` | 194 | `node:child_process`, `node:fs`, `node:path`, `node:process`, `node:url` |
| `scripts/reconcile_stock.ts` | 168 | `better-sqlite3`, `path` |
| `scripts/restore_ledger_commands.sql` | 73 | — |
| `scripts/restore_ledger_from_dump.cjs` | 55 | — |
| `scripts/verify_audit_math.ts` | 52 | — |
| `scripts/verify_persistence.cjs` | 103 | — |
| `scripts/verify_stock_fix.cjs` | 77 | — |
| `server/db.ts` | 494 | `better-sqlite3`, `path`, `url` |
| `server/index.ts` | 1246 | `./db`, `./routes/activationRoutes.js`, `./routes/auditRoutes.js`, `./routes/bulkRoutes.js`, `./routes/cloudRegistry.js`, `./routes/currencies.js`, `./routes/dgiiRoutes.js`, `./routes/emailRoutes.js`, `./routes/fiscalRoutes.js`, `./routes/maintenance.js`, `./routes/passKitRoutes.js`, `./routes/setupRoutes.js`, `./routes/supplierRoutes.js`, `./routes/sync.js`, `./routes/taxes.js`, `./routes/terminalConfigRoutes.js`, `./routes/walletRoutes.js`, `./services/emailService.js`, `./services/terminalOperationalState.js`, `./socket.js`, `cors`, `express`, `http`, `os`, `path`, `url` |
| `server/kds_service.py` | 575 | — |
| `server/migration_affected_invoice.sql` | 3 | — |
| `server/migration_v2_sync_fix.sql` | 41 | — |
| `server/recovered.sql` | 3266 | — |
| `server/routes/activationRoutes.ts` | 325 | `@supabase/supabase-js`, `crypto`, `express`, `fs`, `path` |
| `server/routes/auditRoutes.ts` | 284 | `../db.js`, `express`, `uuid` |
| `server/routes/bulkRoutes.ts` | 136 | `../db.js`, `../socket.js`, `express` |
| `server/routes/cloudRegistry.ts` | 649 | `express`, `fs`, `os`, `path` |
| `server/routes/currencies.ts` | 260 | `../../types`, `../db`, `express` |
| `server/routes/dgiiRoutes.ts` | 161 | `express` |
| `server/routes/emailRoutes.ts` | 110 | `../../types.js`, `../db.js`, `../services/emailService.js`, `express` |
| `server/routes/fiscalRoutes.ts` | 287 | `../services/fiscal/credentials.js`, `../services/fiscal/providers/base.js`, `../services/fiscal/providers/index.js`, `express` |
| `server/routes/maintenance.ts` | 92 | `../db.js`, `express` |
| `server/routes/passKitRoutes.ts` | 134 | `../db.js`, `../wallet/applePassGenerator.js`, `express` |
| `server/routes/setupRoutes.ts` | 1203 | `../../types`, `../../utils/terminalBindingHierarchy`, `../../utils/terminalConfigSnapshot`, `../db`, `../services/terminalOperationalState`, `express` |
| `server/routes/supplierRoutes.ts` | 98 | `../../types`, `../db.js`, `crypto`, `express` |
| `server/routes/sync.ts` | 2772 | `../../services/sync/erpOutboundPayloads.js`, `../../services/sync/sourceIdentity.js`, `../db.js`, `../services/erpInboxForward.js`, `../socket.js`, `crypto`, `express`, `fs`, `path` |
| `server/routes/taxes.ts` | 34 | `../db`, `express` |
| `server/routes/terminalConfigRoutes.ts` | 811 | `../../types`, `../../utils/terminalConfigSnapshot`, `../db`, `../services/terminalOperationalState`, `express`, `node:crypto` |
| `server/routes/walletRoutes.ts` | 112 | `../db.js`, `../services/emailService.js`, `../wallet/apnsService.js`, `../wallet/applePassGenerator.js`, `../wallet/googlePassGenerator.js`, `express` |
| `server/schema.sql` | 598 | — |
| `server/seed.js` | 223 | `fs`, `path`, `url` |
| `server/services/emailService.ts` | 396 | `../../types`, `../../utils/zReportPaymentSummary`, `../db.js`, `fs`, `path`, `resend`, `url` |
| `server/services/erpInboxForward.ts` | 649 | `../../services/sync/erpOutboundPayloads.js`, `../db.js`, `node:crypto` |
| `server/services/fiscal/credentials.ts` | 367 | `../../db.js`, `./providers/base.js` |
| `server/services/fiscal/providers/base.ts` | 142 | — |
| `server/services/fiscal/providers/digifact.ts` | 803 | `../credentials.js`, `./base.js` |
| `server/services/fiscal/providers/index.ts` | 16 | `./base.js`, `./digifact.js`, `./polaris.js` |
| `server/services/fiscal/providers/polaris.ts` | 684 | `../credentials.js`, `./base.js` |
| `server/services/terminalOperationalState.ts` | 55 | `../../types`, `../../utils/documentSeriesIdentity`, `../../utils/terminalConfigSnapshot`, `../db` |
| `server/socket.ts` | 49 | `http`, `https`, `socket.io` |
| `server/wallet/apnsService.ts` | 126 | `../../types.js`, `http2` |
| `server/wallet/applePassGenerator.ts` | 104 | `../../types.js` |
| `server/wallet/googlePassGenerator.ts` | 79 | `../../types.js` |
| `services/AgendaService.ts` | 555 | `../types`, `../utils/db`, `uuid` |
| `services/BiometricAuthService.ts` | 207 | `../types` |
| `services/CheckoutDiagnosticDelivery.ts` | 131 | `./CheckoutDiagnostics` |
| `services/CheckoutDiagnosticTransport.ts` | 43 | `./CheckoutDiagnosticDelivery`, `./sync/TerminalCredentialStore` |
| `services/CheckoutDiagnostics.ts` | 284 | `./CheckoutDiagnosticDelivery`, `./CheckoutPerformanceDiagnostics`, `uuid` |
| `services/CheckoutPerformanceDiagnostics.ts` | 348 | `../types`, `../utils/interactionPerformance` |
| `services/CheckoutPrintTracking.ts` | 11 | `./CheckoutDiagnostics` |
| `services/auth/AuthLevelService.ts` | 257 | `../../types` |
| `services/currency/CurrencyService.ts` | 140 | `../../types`, `../../utils/db` |
| `services/customers/customerPresentation.ts` | 57 | `../../types` |
| `services/db/DatabaseAdapter.ts` | 104 | `./SyncMonitorPage` |
| `services/db/SyncMonitorPage.ts` | 86 | — |
| `services/db/adapters/CapacitorSQLiteAdapter.ts` | 829 | `../../sync/DurableOutboxSchema`, `../../sync/masterNumberRangeContract`, `../DatabaseAdapter`, `../SyncMonitorPage`, `@capacitor/core` |
| `services/db/adapters/IndexedDBAdapter.ts` | 902 | `../../sync/masterNumberRangeContract`, `../DatabaseAdapter` |
| `services/db/adapters/LocalStorageAdapter.ts` | 153 | `../DatabaseAdapter` |
| `services/db/adapters/NetworkAdapter.ts` | 334 | `../../../utils/cloudMasterRegistry`, `../DatabaseAdapter` |
| `services/db/adapters/SQLiteWASMAdapter.ts` | 284 | `../DatabaseAdapter`, `sql.js` |
| `services/db/index.ts` | 27 | `../recovery/RecoveryDatabase`, `../recovery/RecoveryRuntime`, `../sync/SyncFeatureFlags`, `./DatabaseAdapter`, `./adapters/CapacitorSQLiteAdapter`, `./adapters/IndexedDBAdapter`, `@capacitor/core` |
| `services/dgii/DGIIValidationService.ts` | 275 | — |
| `services/dialog/ClicDialogService.ts` | 131 | — |
| `services/email/receiptEmailPayload.ts` | 206 | `../../types`, `../../utils/fiscal/fiscalHelpers`, `../../utils/lineDiscountPresentation`, `../../utils/terminalSnapshotSellers`, `./receiptEmailService` |
| `services/email/receiptEmailService.ts` | 172 | `../../utils/erpBaseUrl`, `../network/httpClient`, `../sync/TerminalCredentialStore`, `uuid` |
| `services/email/zReportEmailService.ts` | 357 | `../../types`, `../../utils/creditRules`, `../../utils/erpBaseUrl`, `../../utils/zReportPaymentSummary`, `../network/httpClient`, `../sync/TerminalCredentialStore` |
| `services/fiscal/fiscalService.ts` | 1608 | `../../types`, `../../utils/cloudMasterRegistry`, `../../utils/db`, `@capacitor/core` |
| `services/geminiService.ts` | 64 | `../types`, `@google/genai` |
| `services/invoices/InvoiceReviewService.ts` | 201 | `../../types`, `../../utils/db`, `../db`, `../sync/DurableOutboxRepository`, `../sync/PermissionService`, `../sync/SyncFeatureFlags`, `../sync/TerminalCredentialStore`, `uuid` |
| `services/localRefundPersistence.ts` | 135 | `../types`, `../utils/db`, `../utils/refundAvailability` |
| `services/network/fetchAndReadWithTimeout.ts` | 25 | — |
| `services/network/httpClient.ts` | 294 | `@capacitor/core` |
| `services/payments/AzulMcmService.ts` | 475 | `../../types`, `@capacitor/core` |
| `services/payments/IngenicoAzulWebApiService.ts` | 523 | `../../types`, `@capacitor/core` |
| `services/payments/PaymentIntentService.ts` | 127 | `../db`, `../db/DatabaseAdapter`, `../sync/SyncFeatureFlags` |
| `services/payments/paymentIntegrationAudit.ts` | 145 | `../../types`, `../../utils/db` |
| `services/printer/BrowserPrint.ts` | 22 | `../dialog/ClicDialogService`, `./PrintFeedback`, `./PrintRuntime` |
| `services/printer/EscPosFormatter.ts` | 1169 | `../../types`, `../../utils/closeReceiptSummary`, `../../utils/fiscalBreakdown`, `../../utils/globalDiscountPresentation`, `../../utils/lineDiscountPresentation`, `../../utils/paymentSettlement`, `../../utils/receiptCouponPresentation`, `../../utils/receiptVariant`, `../../utils/taxIdentity`, `../../utils/terminalSnapshotSellers`, `../../utils/transactionHistoryPresentation`, `../../utils/zReportPaymentSummary` |
| `services/printer/LocalPrintAgentService.ts` | 82 | `./PrintFeedback` |
| `services/printer/NativePrintBridge.ts` | 437 | `../../types`, `./NativePrintContract`, `./PrintFeedback` |
| `services/printer/NativePrintContract.ts` | 139 | `../../types` |
| `services/printer/OfflinePrintQueueService.ts` | 213 | `../../types`, `../../utils/db`, `../../utils/posSaleActivity`, `./PrintRouterService` |
| `services/printer/PrintFeedback.ts` | 76 | `../dialog/ClicDialogService` |
| `services/printer/PrintRouterService.ts` | 189 | `../../types`, `./LocalPrintAgentService`, `./NativePrintBridge`, `./PrintFeedback`, `./PrintRuntime` |
| `services/printer/PrintRuntime.ts` | 28 | `./NativePrintBridge` |
| `services/printer/ThermalPrinterService.ts` | 132 | `../../types`, `../../utils/printCopies`, `./BrowserPrint`, `./EscPosFormatter`, `./PrintFeedback`, `./PrintRouterService`, `./PrintRuntime`, `./templates/ZReportReceipt` |
| `services/printer/templates/ZReportReceipt.ts` | 307 | `../../../types`, `../../../utils/closeReceiptSummary`, `../../../utils/transactionHistoryPresentation`, `../../../utils/zReportPaymentSummary` |
| `services/recovery/AutomaticRecovery.ts` | 68 | `../db/DatabaseAdapter`, `./OriginalCapture` |
| `services/recovery/ClosePreparation.ts` | 531 | `../db/DatabaseAdapter`, `./NativeZConfiguration`, `./NativeZReport`, `./OriginalCapture`, `./OriginalCodec`, `./PendingOperationsRecovery`, `./RecoveryDatabase`, `./RecoveryJson`, `./RecoveryUuid` |
| `services/recovery/CommittedCloseCapture.ts` | 85 | `../db/DatabaseAdapter`, `./NativeZConfiguration`, `./OriginalCapture`, `./OriginalCodec` |
| `services/recovery/NativeZConfiguration.ts` | 83 | `../../types`, `./OriginalCodec` |
| `services/recovery/NativeZReport.ts` | 187 | `../../types`, `../../utils/analytics`, `../../utils/closeReceiptSummary`, `../../utils/closeReportOptions`, `../../utils/orderServiceType`, `../../utils/zReportPaymentSummary` |
| `services/recovery/OriginalCapture.ts` | 88 | `./OriginalCodec`, `./RecoveryUuid` |
| `services/recovery/OriginalCodec.ts` | 135 | — |
| `services/recovery/PendingOperationsRecovery.ts` | 970 | `../db/DatabaseAdapter`, `./OriginalCapture`, `./OriginalCodec`, `./RecoveryJson`, `./RetainedCaptureSet`, `./RetainedEpoch`, `./RetainedRestore` |
| `services/recovery/ReceivedCloseFlow.ts` | 720 | `../db/DatabaseAdapter`, `./ClosePreparation`, `./CommittedCloseCapture`, `./OriginalCapture`, `./OriginalCodec`, `./RecoveryDatabase`, `./RecoveryJson`, `./RecoveryUuid`, `./RetainedCaptureSet` |
| `services/recovery/RecoveryAvailability.ts` | 52 | — |
| `services/recovery/RecoveryCloseController.ts` | 300 | `../../utils/documentSeriesIdentity`, `../db/DatabaseAdapter`, `./ClosePreparation`, `./OriginalCodec`, `./ReceivedCloseFlow`, `./RecoveryDatabase`, `./RecoveryUuid` |
| `services/recovery/RecoveryDatabase.ts` | 270 | `../db/DatabaseAdapter`, `./NativeZConfiguration`, `./OriginalCapture`, `./OriginalCodec`, `./RecoveryUuid` |
| `services/recovery/RecoveryJson.ts` | 48 | — |
| `services/recovery/RecoveryRuntime.ts` | 33 | `../sync/SyncProfile`, `../sync/TerminalCredentialStore` |
| `services/recovery/RecoveryUuid.ts` | 15 | — |
| `services/recovery/RetainedCaptureSet.ts` | 192 | `../db/DatabaseAdapter`, `./OriginalCapture`, `./OriginalCodec`, `./PendingOperationsRecovery`, `./RecoveryDatabase`, `./RecoveryJson`, `./RecoveryUuid` |
| `services/recovery/RetainedEpoch.ts` | 234 | `../db/DatabaseAdapter`, `./OriginalCapture`, `./OriginalCodec`, `./RecoveryDatabase`, `./RecoveryJson`, `./RecoveryUuid`, `./RetainedCaptureSet` |
| `services/recovery/RetainedOriginals.ts` | 109 | `../db/DatabaseAdapter`, `./OriginalCapture`, `./OriginalCodec`, `./RecoveryDatabase`, `./RecoveryUuid` |
| `services/recovery/RetainedRestore.ts` | 255 | `../db/DatabaseAdapter`, `./OriginalCapture`, `./OriginalCodec`, `./PendingOperationsRecovery`, `./RecoveryDatabase`, `./RecoveryJson`, `./RetainedCaptureSet`, `./RetainedEpoch` |
| `services/recovery/ZReportRecoveryService.ts` | 172 | `../../types`, `../../utils/db`, `../../utils/paymentSettlement` |
| `services/recovery/recoveryService.ts` | 171 | `../db`, `../sync/ApiSyncAdapter`, `../sync/SyncFeatureFlags`, `./AutomaticRecovery`, `./ClosePreparation`, `./PendingOperationsRecovery`, `./ReceivedCloseFlow`, `./RecoveryAvailability`, `./RecoveryCloseController`, `./RecoveryDatabase`, `./RecoveryRuntime`, `./RetainedOriginals` |
| `services/refunds/erpRefundSource.ts` | 253 | `../../types`, `../../utils/refundAvailability` |
| `services/routing/TerminalRouter.ts` | 273 | `../../types`, `../auth/AuthLevelService` |
| `services/setup/activationTenantIdentity.ts` | 91 | — |
| `services/setup/erpTerminalSetup.ts` | 1947 | `../../types`, `../../utils/db`, `../../utils/deviceProfile`, `../../utils/deviceRoleHelpers`, `../../utils/orderTakerPolicy`, `../../utils/supabase`, `../../utils/syncCapabilities`, `../../utils/terminalAuthorizationGuard`, `../../utils/terminalBindingHierarchy`, `../network/httpClient`, `../sync/SyncProfile`, `../sync/TerminalConfigRequestCoordinator`, `../sync/TerminalCredentialStore`, `../sync/deviceToken`, `../sync/erpRegisterResponse`, `../sync/terminalIdentity` |
| `services/setup/masterPairingConnection.ts` | 173 | `../../types` |
| `services/setup/terminalDeviceRequests.ts` | 58 | `../network/httpClient` |
| `services/sync/AdaptivePollingScheduler.ts` | 93 | `./RealtimeNotificationService` |
| `services/sync/ApiSyncAdapter.ts` | 6215 | `../../types`, `../../utils/deviceRevocation`, `../../utils/documentSeriesIdentity`, `../../utils/erpBaseUrl`, `../../utils/erpPaymentMethods`, `../../utils/erpSyncLifecycle`, `../../utils/syncCapabilities`, `../../utils/terminalAuthorizationGuard`, `../network/httpClient`, `../recovery/PendingOperationsRecovery`, `../recovery/RecoveryRuntime`, `./ErpMasterSyncContract`, `./PermissionService`, `./PosCloudStagingService`, `./SyncErrorDiagnostic`, `./SyncFeatureFlags`, `./SyncProfile`, `./TerminalCredentialStore`, `./customerIdentityContract`, `./deviceToken`, `./erpOutboundPayloads`, `./erpRegisterResponse`, `./masterPullFailure`, `./operationalAcknowledgement`, `./terminalIdentity` |
| `services/sync/AuthenticatedActivityTracker.ts` | 44 | — |
| `services/sync/BackgroundSyncManager.ts` | 921 | `../../types`, `../../utils/backgroundSyncScheduler`, `../../utils/db`, `../../utils/posSaleActivity`, `../db`, `../recovery/PendingOperationsRecovery`, `./ApiSyncAdapter`, `./AuthenticatedActivityTracker`, `./DurableOutboxBatchSender`, `./DurableOutboxRepository`, `./MasterNumberRangeService`, `./PermissionService`, `./SyncFeatureFlags`, `./SyncMetrics`, `./SyncProfile`, `./TransferReceiptService` |
| `services/sync/CatalogEditQueue.ts` | 140 | — |
| `services/sync/ClosedTransactionMembership.ts` | 228 | `../../types` |
| `services/sync/ConsignmentSyncService.ts` | 637 | `../../types`, `../../utils/deviceRevocation`, `../network/httpClient`, `./SyncProfile`, `./TerminalCredentialStore`, `./deviceToken` |
| `services/sync/CustomerSyncQueue.ts` | 37 | `../../types`, `../../utils/db`, `./PermissionService` |
| `services/sync/DurableOutboxBatchSender.ts` | 238 | `../CheckoutDiagnostics`, `./ApiSyncAdapter`, `./DurableOutboxRepository`, `./SyncMetrics` |
| `services/sync/DurableOutboxRepository.ts` | 356 | `../CheckoutDiagnostics`, `../db`, `../db/DatabaseAdapter`, `./SalePostedContract`, `./SyncMetrics`, `uuid` |
| `services/sync/DurableOutboxSchema.ts` | 53 | — |
| `services/sync/ErpMasterSyncContract.ts` | 110 | — |
| `services/sync/ErpMasterSyncStrategy.ts` | 18 | — |
| `services/sync/InventorySyncService.ts` | 154 | `../../types`, `../../utils/posSaleActivity`, `./ApiSyncAdapter`, `./PermissionService` |
| `services/sync/LocalSyncAdapter.ts` | 155 | — |
| `services/sync/MasterDataImageCacheService.ts` | 687 | `../../types`, `../../utils/db`, `@capacitor/core`, `@capacitor/filesystem` |
| `services/sync/MasterNumberRangeService.ts` | 183 | `../db`, `../db/DatabaseAdapter`, `./ApiSyncAdapter`, `./PermissionService`, `./SyncProfile`, `./masterNumberRangeContract`, `./terminalIdentity` |
| `services/sync/NetworkScanner.ts` | 137 | `../../utils/masterServerEligibility` |
| `services/sync/NetworkSyncService.ts` | 626 | `../../utils/cloudMasterRegistry`, `../../utils/db`, `../db` |
| `services/sync/PaymentMethodsSync.ts` | 25 | `../../types`, `../../utils/erpPaymentMethods` |
| `services/sync/PermissionService.ts` | 149 | `../../types` |
| `services/sync/PosCloudStagingService.ts` | 101 | `../../utils/db`, `./ApiSyncAdapter`, `./SyncProfile` |
| `services/sync/PosUserSyncQueue.ts` | 126 | `../../types`, `../../utils/db`, `../../utils/posUserReconciliation`, `./PermissionService`, `uuid` |
| `services/sync/PrivateRealtimeAuthorization.test.mjs` | 27 | `./PrivateRealtimeAuthorization.ts`, `vitest` |
| `services/sync/PrivateRealtimeAuthorization.ts` | 123 | `../../utils/deviceRevocation`, `../../utils/erpBaseUrl`, `./TerminalCredentialStore`, `./deviceToken`, `@supabase/supabase-js` |
| `services/sync/ProductImageCacheService.ts` | 754 | `../../types`, `../../utils/db`, `../../utils/erpFiscalCatalogSync`, `../../utils/masterIdentity`, `../../utils/posSaleActivity`, `../../utils/productReferences`, `@capacitor/core`, `@capacitor/filesystem` |
| `services/sync/RealtimeHintScope.ts` | 41 | — |
| `services/sync/RealtimeNotificationService.ts` | 325 | `../../utils/deviceRevocation`, `../../utils/erpSyncLifecycle`, `./PrivateRealtimeAuthorization`, `./RealtimeHintScope`, `./SyncFeatureFlags`, `./SyncMetrics`, `./SyncTriggerCoordinator`, `@supabase/supabase-js` |
| `services/sync/SalePostedContract.ts` | 431 | `../../types`, `../CheckoutDiagnostics`, `./customerIdentityContract` |
| `services/sync/SeriesSyncService.ts` | 118 | `../../types`, `../../utils/db` |
| `services/sync/SyncErrorDiagnostic.ts` | 589 | `./SyncProfile` |
| `services/sync/SyncFeatureFlags.ts` | 84 | — |
| `services/sync/SyncManager.ts` | 7467 | `../../types`, `../../utils/backgroundSyncScheduler`, `../../utils/cloudMasterRegistry`, `../../utils/db`, `../../utils/deviceRevocation`, `../../utils/documentSeriesIdentity`, `../../utils/erpBaseUrl`, `../../utils/erpFiscalCatalogSync`, `../../utils/erpSecuritySnapshot`, `../../utils/erpSyncLifecycle`, `../../utils/masterIdentity`, `../../utils/masterOperationalApi`, `../../utils/posCatalogDebugTrace`, `../../utils/posCatalogPresentation`, `../../utils/posMasterCatalogContract`, `../../utils/posSaleActivity`, `../../utils/posUserReconciliation`, `../../utils/productReferences`, `../../utils/restaurantProductConfig`, `../../utils/taxIdentity`, `../../utils/terminalConfigSnapshot`, `../db`, `../network/fetchAndReadWithTimeout`, `./ApiSyncAdapter`, `./ClosedTransactionMembership`, `./ErpMasterSyncContract`, `./ErpMasterSyncStrategy`, `./MasterDataImageCacheService`, `./MasterNumberRangeService`, `./NetworkScanner`, `./PaymentMethodsSync`, `./PermissionService`, `./PosCloudStagingService`, `./ProductImageCacheService`, `./RealtimeNotificationService`, `./SyncErrorDiagnostic`, `./SyncProfile`, `./SyncTriggerCoordinator`, `./deviceToken`, `./preserveLocalCatalog`, `./terminalIdentity`, `@capacitor/core`, `uuid` |
| `services/sync/SyncMetrics.ts` | 145 | — |
| `services/sync/SyncProfile.ts` | 657 | `../../utils/erpBaseUrl`, `./erpRegisterResponse`, `./terminalIdentity` |
| `services/sync/SyncQueue.ts` | 136 | `../db` |
| `services/sync/SyncTriggerCoordinator.ts` | 182 | `./SyncMetrics` |
| `services/sync/TerminalConfigRequestCoordinator.ts` | 298 | — |
| `services/sync/TerminalCredentialStore.ts` | 344 | `../../types`, `./terminalIdentity`, `@capacitor/preferences` |
| `services/sync/TransactionSyncService.ts` | 115 | `../../types`, `../db`, `./ApiSyncAdapter`, `./PermissionService` |
| `services/sync/TransferReceiptService.ts` | 448 | `../../types`, `../../utils/db`, `../../utils/deviceRevocation`, `./ApiSyncAdapter`, `uuid` |
| `services/sync/catalogEdits.ts` | 270 | `../../types`, `../../utils/backgroundSyncScheduler`, `../../utils/db`, `../../utils/taxIdentity`, `../db`, `./ApiSyncAdapter`, `./CatalogEditQueue`, `./SyncProfile`, `./TerminalCredentialStore`, `uuid` |
| `services/sync/catalogLocalChanges.ts` | 253 | `../../types`, `./CatalogEditQueue` |
| `services/sync/catalogSnapshotFence.ts` | 63 | `./CatalogEditQueue` |
| `services/sync/customerIdentityContract.ts` | 66 | `../../types` |
| `services/sync/deviceToken.ts` | 209 | `./TerminalCredentialStore` |
| `services/sync/erpOutboundPayloads.ts` | 250 | `../../types`, `./customerIdentityContract`, `./sourceIdentity` |
| `services/sync/erpRegisterResponse.ts` | 364 | `./SyncProfile`, `./terminalIdentity` |
| `services/sync/masterCustomerReconciliation.ts` | 33 | `../../types` |
| `services/sync/masterNumberRangeContract.ts` | 175 | `../db/DatabaseAdapter` |
| `services/sync/masterPullFailure.ts` | 76 | — |
| `services/sync/operationalAcknowledgement.ts` | 26 | — |
| `services/sync/preserveLocalCatalog.ts` | 165 | `../db`, `./CatalogEditQueue`, `./catalogEdits`, `./catalogLocalChanges`, `./catalogSnapshotFence` |
| `services/sync/saveLocalCatalog.ts` | 96 | `../../types`, `../../utils/db`, `../db`, `../db/DatabaseAdapter`, `./CatalogEditQueue`, `./SyncProfile`, `./catalogEdits`, `./catalogLocalChanges`, `uuid` |
| `services/sync/sourceIdentity.ts` | 493 | `../../types` |
| `services/sync/terminalIdentity.ts` | 114 | — |
| `services/transactionService.ts` | 895 | `../types`, `../utils/db`, `../utils/documentSeriesIdentity`, `../utils/terminalConfigSnapshot`, `./CheckoutDiagnostics`, `./recovery/OriginalCapture`, `./sync/SyncFeatureFlags`, `./sync/customerIdentityContract`, `./sync/sourceIdentity` |
| `services/uberEatsPosService.ts` | 225 | `../types` |
| `services/version/posApkUpdateService.ts` | 324 | `../../types`, `@capacitor/core` |
| `services/zreports/ZReportSequenceContinuity.ts` | 125 | `../../types` |
| `supabase/migrations/202604300001_crm_opportunities_bookings.sql` | 106 | — |
| `supabase/migrations/20260825164006_invoice_review_audit_foundation.sql` | 182 | — |
| `tailwind.config.cjs` | 46 | — |
| `test_connection_endpoints.js` | 44 | `node-fetch` |
| `test_visor_sync.ts` | 52 | `./utils/visorSync` |
| `tests/activationTenantIdentity.test.ts` | 40 | `../services/setup/activationTenantIdentity`, `node:assert/strict`, `node:test` |
| `tests/adaptivePollingScheduler.test.ts` | 126 | `../services/sync/AdaptivePollingScheduler`, `node:assert/strict`, `node:test` |
| `tests/androidActivationKeyboardContract.test.ts` | 49 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/androidBackgroundSessionResume.test.ts` | 79 | `../utils/nativeSessionResume`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/androidCameraPermissionContract.test.ts` | 35 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/androidDiscountKeypadContract.test.ts` | 27 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/androidFingerprintAsyncContract.test.ts` | 28 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/androidMasterRestaurantContract.test.ts` | 322 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/androidMasterRuntimePollingContract.test.ts` | 50 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/androidMasterSetupContract.test.ts` | 174 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/androidOperationalKeypadContract.test.ts` | 50 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/androidReleaseNetworkSecurity.test.ts` | 64 | `node:assert/strict`, `node:fs/promises`, `node:test` |
| `tests/androidRestaurantKeyboardOverlayContract.test.ts` | 21 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/androidUuidCompatibility.test.ts` | 20 | `../utils/uuid`, `node:assert/strict`, `node:test` |
| `tests/apkReleaseGate.test.ts` | 102 | `../scripts/qa/apk-release-gate.mjs`, `node:assert/strict`, `node:fs/promises`, `node:test` |
| `tests/automaticCatalogSaves.integration.ts` | 328 | `node:assert/strict`, `node:test` |
| `tests/backgroundSyncRecoveryContract.test.ts` | 20 | `node:assert/strict`, `node:fs/promises`, `node:test` |
| `tests/biometricAuthService.test.ts` | 71 | `../services/BiometricAuthService`, `../types`, `node:assert/strict`, `node:test` |
| `tests/cameraSelection.test.ts` | 27 | `../utils/cameraSelection`, `node:assert/strict`, `node:test` |
| `tests/canonicalErpTerminalIdentity.test.ts` | 184 | `../services/sync/TerminalCredentialStore`, `../services/sync/erpRegisterResponse`, `../services/sync/terminalIdentity`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/cartItemEditPermissions.test.ts` | 96 | `../utils/cartItemEditPermissions`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/cartQuantitySafety.test.ts` | 39 | `../utils/cartQuantity`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/cashMovementReceipt.test.ts` | 80 | `../services/printer/EscPosFormatter`, `../types`, `../utils/numericInput`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/catalogConflictPermissions.test.ts` | 34 | `../services/sync/catalogEdits`, `../types`, `node:assert/strict`, `node:test` |
| `tests/catalogEditPersistence.test.ts` | 22 | `../services/db/adapters/IndexedDBAdapter`, `fake-indexeddb`, `node:assert/strict`, `node:test` |
| `tests/catalogEditQueue.test.ts` | 102 | `../services/sync/CatalogEditQueue`, `node:assert/strict`, `node:test` |
| `tests/catalogLocalChanges.test.ts` | 109 | `../services/sync/catalogLocalChanges`, `node:assert/strict`, `node:test` |
| `tests/catalogMultiTerminalRoundTrip.test.ts` | 68 | `../services/sync/CatalogEditQueue`, `node:assert/strict`, `node:test` |
| `tests/catalogPayloadCloneCompatibility.test.ts` | 32 | `../services/sync/preserveLocalCatalog`, `node:assert/strict`, `node:test` |
| `tests/catalogProductLayoutContract.test.ts` | 26 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/catalogReleaseFlag.test.ts` | 14 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/catalogSnapshotFence.test.ts` | 43 | `../services/sync/CatalogEditQueue`, `../services/sync/catalogSnapshotFence`, `node:assert/strict`, `node:test` |
| `tests/catalogSnapshotPreservationContract.test.ts` | 25 | `node:assert/strict`, `node:fs/promises`, `node:test` |
| `tests/categoryOptions.test.ts` | 31 | `../utils/categoryOptions`, `node:assert/strict`, `node:test` |
| `tests/checkoutDiagnosticDelivery.test.ts` | 72 | `../services/CheckoutDiagnosticDelivery`, `../services/CheckoutDiagnostics`, `fake-indexeddb`, `node:assert/strict`, `node:test` |
| `tests/checkoutDiagnostics.test.ts` | 118 | `../services/CheckoutDiagnostics`, `../services/CheckoutPerformanceDiagnostics`, `node:assert/strict`, `node:test` |
| `tests/checkoutEvidence.test.ts` | 33 | `../services/CheckoutDiagnosticDelivery`, `../services/CheckoutDiagnostics`, `../services/CheckoutPrintTracking`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/checkoutLatency.test.ts` | 59 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/checkoutPerformanceDiagnostics.test.ts` | 50 | `../services/CheckoutPerformanceDiagnostics`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/clicDialogService.test.ts` | 31 | `../services/dialog/ClicDialogService`, `node:assert/strict`, `node:test` |
| `tests/clientTableBatchSyncContract.test.ts` | 90 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/clientTableMergeKdsDensityContract.test.ts` | 46 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/closePreparation.test.ts` | 482 | `../services/recovery/ClosePreparation`, `../services/recovery/OriginalCodec`, `./helpers/closePreparationSQLite`, `node:assert/strict`, `node:test` |
| `tests/closeReceiptSummary.test.ts` | 127 | `../services/printer/EscPosFormatter`, `../services/printer/templates/ZReportReceipt`, `../utils/closeReceiptSummary`, `../utils/orderServiceType`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/closeReportOptions.test.ts` | 113 | `../services/printer/templates/ZReportReceipt`, `../types`, `../utils/closeReportOptions`, `node:assert/strict`, `node:test` |
| `tests/closeReportPrintingHotfix.test.ts` | 90 | `../services/printer/EscPosFormatter`, `../services/printer/templates/ZReportReceipt`, `../types`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/closedTransactionMembership.test.ts` | 226 | `../services/sync/ClosedTransactionMembership`, `../types`, `node:assert/strict`, `node:test` |
| `tests/cloudMasterRegistryTenantIdentity.test.ts` | 54 | `../utils/tenantIdentityStorage`, `node:assert/strict`, `node:test` |
| `tests/configPushV2Contract.test.ts` | 758 | `node:assert/strict`, `node:test` |
| `tests/configPushV2Outbox.test.ts` | 444 | `../utils/erpHeartbeatScheduler`, `node:assert/strict`, `node:test` |
| `tests/couponRedemptionLifecycle.test.ts` | 60 | `../types.ts`, `../utils/couponService.ts`, `node:assert/strict`, `node:test` |
| `tests/couponScan.test.ts` | 18 | `../utils/couponScan.ts`, `node:assert/strict`, `node:test` |
| `tests/customerDisplay.test.ts` | 259 | `../utils/customerDisplay`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/customerNumberSync.test.ts` | 91 | `../services/sync/SalePostedContract`, `../services/sync/customerIdentityContract`, `../services/sync/erpOutboundPayloads`, `../types`, `node:assert/strict`, `node:test` |
| `tests/customerPresentation.test.ts` | 35 | `../services/customers/customerPresentation`, `../types`, `node:assert/strict`, `node:test` |
| `tests/desktopSearchCameraAction.test.ts` | 42 | `../types`, `../utils/cameraCapability`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/deviceIdentityRecovery.test.ts` | 58 | `../utils/deviceRevocation`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/deviceProfile.test.ts` | 84 | `../types`, `../utils/deviceProfile`, `node:assert/strict`, `node:test` |
| `tests/durableOutboxBatchSender.test.ts` | 297 | `../services/sync/DurableOutboxBatchSender`, `../services/sync/DurableOutboxRepository`, `node:assert/strict`, `node:fs/promises`, `node:test` |
| `tests/durableOutboxV2.test.ts` | 519 | `../services/db/DatabaseAdapter`, `../services/payments/PaymentIntentService`, `../services/sync/DurableOutboxRepository`, `../services/sync/DurableOutboxSchema`, `../services/sync/SalePostedContract`, `better-sqlite3`, `node:assert/strict`, `node:fs/promises`, `node:test` |
| `tests/emptyTableChargeRegression.test.ts` | 68 | `../types`, `../utils/tableTicketIntegrity`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/erpDirectTakeover.test.ts` | 179 | `node:assert/strict`, `node:test` |
| `tests/erpFiscalCatalogFullSync.test.ts` | 90 | `../utils/erpFiscalCatalogSync`, `../utils/taxSummary`, `node:assert/strict`, `node:fs`, `node:path`, `node:test`, `node:url` |
| `tests/erpHeartbeatScheduler.test.ts` | 209 | `../utils/erpHeartbeatScheduler`, `node:assert/strict`, `node:test` |
| `tests/erpMasterSyncStrategy.test.ts` | 84 | `../services/sync/ErpMasterSyncContract`, `../services/sync/ErpMasterSyncStrategy`, `node:assert/strict`, `node:fs/promises`, `node:test` |
| `tests/erpPaymentMethods.test.ts` | 107 | `../constants`, `../services/sync/PaymentMethodsSync`, `../utils/erpPaymentMethods`, `../utils/terminalConfigSnapshot`, `node:assert/strict`, `node:test` |
| `tests/erpRefundSource.test.ts` | 130 | `../services/refunds/erpRefundSource`, `../services/sync/erpOutboundPayloads`, `node:assert/strict`, `node:test` |
| `tests/erpRoleAuthority.test.ts` | 156 | `../constants`, `../utils/erpSecuritySnapshot`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/erpTerminalListing.test.ts` | 239 | `node:assert/strict`, `node:test` |
| `tests/fiscalLegacyModeRegression.test.ts` | 206 | `../constants`, `../utils/fiscal/fiscalHelpers`, `../utils/terminalConfigSnapshot`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/fixtures/global-scanner.tsx` | 28 | `../../hooks/useBarcodeScanner`, `../../utils/globalBarcodeCapture`, `react`, `react-dom/client` |
| `tests/fixtures/masterSetupDirectoryHarness.kt` | 177 | — |
| `tests/fixtures/nativeRecoveryOperations.ts` | 324 | — |
| `tests/fixtures/recovery-close-screen.tsx` | 55 | `../../components/RecoveryCloseDialog`, `../../index.css`, `react`, `react-dom/client` |
| `tests/fixtures/service-header.tsx` | 28 | `../../components/OrderServiceTypeButton`, `../../components/OrderServiceTypeDialog`, `../../index.css`, `../../types`, `lucide-react`, `react`, `react-dom/client` |
| `tests/fixtures/supermarket-ticket.tsx` | 24 | `../../components/ActionGrid`, `../../components/ProductTableSupermarket`, `../../components/SupermarketTicketSummary`, `../../index.css`, `../../types`, `react`, `react-dom/client` |
| `tests/globalBarcodeCapture.test.ts` | 245 | `../hooks/useBarcodeScanner`, `../utils/globalBarcodeCapture`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/globalDiscountPresentation.test.ts` | 125 | `../services/printer/EscPosFormatter`, `../utils/globalDiscountPresentation`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/handheldAdminRouting.test.ts` | 12 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/handheldInventorySync.test.ts` | 26 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/helpers/closePreparationSQLite.ts` | 76 | `../../services/db/adapters/CapacitorSQLiteAdapter`, `../../services/recovery/ClosePreparation`, `../../services/recovery/RecoveryDatabase`, `node:fs`, `node:os`, `node:path`, `node:sqlite` |
| `tests/inventoryPdaScanner.test.ts` | 42 | `../utils/inventoryScanner`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/inventoryProductSearch.test.ts` | 60 | `../types`, `../utils/inventoryProductSearch`, `node:assert/strict`, `node:test` |
| `tests/invoiceReviewFoundation.test.ts` | 42 | `../services/invoices/InvoiceReviewService`, `node:assert/strict`, `node:test`, `uuid` |
| `tests/itemTaxAuthority.test.ts` | 87 | `../types`, `../utils/fiscalBreakdown`, `../utils/taxSummary`, `node:assert/strict`, `node:test` |
| `tests/joinedTableTicketPersistence.test.ts` | 81 | `node:assert/strict`, `node:fs`, `node:test`, `typescript` |
| `tests/kdsDensityContract.test.ts` | 29 | `../components/kds/KitchenDisplay`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/kdsPresentation.test.ts` | 15 | `../utils/kdsPresentation`, `node:assert/strict`, `node:test` |
| `tests/licenseGuard.test.ts` | 262 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/lineDiscountPresentation.test.ts` | 47 | `../utils/lineDiscountPresentation`, `node:assert/strict`, `node:test` |
| `tests/localRefundPersistenceRemote.test.ts` | 90 | `../services/localRefundPersistence`, `../services/sync/BackgroundSyncManager`, `../types`, `../utils/db`, `../utils/fiscalPreparedAuthority`, `node:assert/strict`, `node:test` |
| `tests/loginDestinationPerformance.test.ts` | 67 | `../utils/terminalLoginLabel`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/masterCustomerReconciliation.test.ts` | 40 | `../services/sync/masterCustomerReconciliation`, `../types`, `node:assert/strict`, `node:test` |
| `tests/masterLanDiscovery.test.ts` | 37 | `node:assert/strict`, `node:test` |
| `tests/masterNumberRangeSqlite.test.ts` | 161 | `../services/db/DatabaseAdapter`, `../services/db/adapters/CapacitorSQLiteAdapter`, `../services/sync/masterNumberRangeContract`, `better-sqlite3`, `node:assert/strict`, `node:fs`, `node:os`, `node:path`, `node:test` |
| `tests/masterNumberRanges.test.ts` | 229 | `node:assert/strict`, `node:fs/promises`, `node:test` |
| `tests/masterOperationalApi.test.ts` | 107 | `../utils/masterOperationalApi`, `node:assert/strict`, `node:test` |
| `tests/masterPairingConnection.test.ts` | 153 | `../services/setup/masterPairingConnection`, `../types`, `node:assert/strict`, `node:test` |
| `tests/masterPullFailure.test.ts` | 70 | `../services/sync/masterPullFailure`, `node:assert/strict`, `node:test` |
| `tests/masterScopedSetupDirectory.test.ts` | 45 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/masterServerEligibility.test.ts` | 69 | `../utils/masterServerEligibility`, `node:assert/strict`, `node:test` |
| `tests/mediaSupport.test.ts` | 23 | `../utils/customerDisplay`, `../utils/media`, `node:assert/strict`, `node:test` |
| `tests/mobileSidebarActionsContract.test.ts` | 30 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/modifierGroupVisuals.test.ts` | 25 | `../components/ModifierModal`, `node:assert/strict`, `node:test` |
| `tests/nativeLocalRegistryTransport.test.ts` | 31 | `node:assert/strict`, `node:fs`, `node:test`, `node:vm`, `typescript` |
| `tests/nativeZConfiguration.test.ts` | 80 | `../services/recovery/NativeZConfiguration`, `../services/recovery/NativeZReport`, `../services/recovery/OriginalCodec`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/nativeZReport.test.ts` | 49 | `../services/recovery/NativeZReport`, `../services/recovery/OriginalCodec`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/networkPrinterBuffer.test.ts` | 40 | `../services/printer/EscPosFormatter`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/numericKeypad.test.ts` | 18 | `../utils/numericInput`, `node:assert/strict`, `node:test` |
| `tests/operationalAcknowledgement.test.ts` | 44 | `../services/sync/operationalAcknowledgement`, `../services/sync/sourceIdentity`, `node:assert/strict`, `node:test` |
| `tests/operatorUiTransition.test.ts` | 37 | `../utils/operatorUiTransition`, `node:assert/strict`, `node:test` |
| `tests/orderServiceType.test.ts` | 144 | `../services/printer/EscPosFormatter`, `../services/printer/templates/ZReportReceipt`, `../services/sync/SalePostedContract`, `../services/sync/sourceIdentity`, `../types`, `../utils/orderServiceType`, `node:assert/strict`, `node:test` |
| `tests/orderServiceTypeHeader.test.ts` | 36 | `../components/OrderServiceTypeButton`, `node:assert/strict`, `node:fs`, `node:test`, `react`, `react-dom/server` |
| `tests/orderServiceTypeSelector.test.ts` | 68 | `../components/ActionGrid`, `../components/OrderServiceTypeDialog`, `../constants`, `../types`, `../utils/orderServiceType`, `../utils/serviceTaxPolicy`, `node:assert/strict`, `node:fs`, `node:test`, `react`, `react-dom/server` |
| `tests/orderTakerMasterRouting.test.ts` | 148 | `../utils/masterOperationalApi`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/orderTakerOperationsContract.test.ts` | 74 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/orderTakerPairingPersistence.test.ts` | 77 | `../constants`, `../types`, `../utils/terminalConfigSnapshot`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/orderTakerPolicy.test.ts` | 62 | `../types`, `../utils/deviceRoleHelpers`, `../utils/orderTakerPolicy`, `node:assert/strict`, `node:test` |
| `tests/paymentDrawerPolicy.test.ts` | 102 | `../constants`, `../services/printer/EscPosFormatter`, `../types`, `node:assert/strict`, `node:test` |
| `tests/paymentFractionPersistenceContract.test.ts` | 18 | `node:assert/strict`, `node:fs`, `node:path`, `node:test`, `node:url` |
| `tests/paymentFractions.test.ts` | 41 | `../utils/paymentFractions`, `node:assert/strict`, `node:test` |
| `tests/paymentMethodsSyncIntegration.test.ts` | 102 | `../services/sync/PaymentMethodsSync`, `../utils/erpPaymentMethods`, `node:assert/strict`, `node:fs`, `node:test`, `node:vm`, `typescript` |
| `tests/paymentReceiptPresentation.test.ts` | 194 | `../services/printer/EscPosFormatter`, `../services/sync/SalePostedContract`, `../utils/paymentSettlement`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/paymentSuccessModalContract.test.ts` | 53 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/pendingOperationsRecovery.test.ts` | 534 | `../services/recovery/OriginalCapture`, `../services/recovery/OriginalCodec`, `../services/recovery/PendingOperationsRecovery`, `../services/recovery/RecoveryDatabase`, `node:assert/strict`, `node:test` |
| `tests/posApkUpdateContract.test.ts` | 28 | `../services/version/posApkUpdateService`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/posCatalogOrganizationContract.test.ts` | 30 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/posCatalogPresentation.test.ts` | 26 | `../utils/posCatalogPresentation`, `node:assert/strict`, `node:test` |
| `tests/posCategoryTwoRowLayout.test.ts` | 48 | `../utils/posCategoryGrid`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/posCategoryVisibilityPersistence.test.ts` | 56 | `../constants`, `../utils/posCatalogPresentation`, `../utils/terminalConfigSnapshot`, `node:assert/strict`, `node:test` |
| `tests/posCompactLayoutContract.test.ts` | 21 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/posIdleRenderContract.test.ts` | 30 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/posMasterCatalogContract.test.ts` | 169 | `../utils/posMasterCatalogContract`, `../utils/restaurantProductConfig`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/posOperationalBugBatch.test.ts` | 65 | `../utils/fiscalBreakdown`, `../utils/posCatalogPresentation`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/posOperationalResponsivenessContract.test.ts` | 143 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/posProductGridTwoByFour.test.ts` | 76 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/posProductPricesIdleContract.test.ts` | 18 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/posRestaurantActionGridLayout.test.ts` | 27 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/posRuntimeLatencyHotfix.test.ts` | 209 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/posTableHeader.test.ts` | 30 | `../utils/posTableHeader`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/posTaxSummaryLegibility.test.ts` | 36 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/posTicketLineLegibility.test.ts` | 25 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/posUserReconciliation.test.ts` | 188 | `../utils/posUserReconciliation`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/posUserSyncQueue.test.ts` | 62 | `../services/sync/PosUserSyncQueue`, `../types`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/posUsersTableJoinKdsContract.test.ts` | 42 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/printCopies.test.ts` | 65 | `../utils/printCopies`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/printCopiesStepper.test.ts` | 51 | `../components/PrintCopiesStepper`, `../utils/printCopies`, `node:assert/strict`, `node:test`, `react`, `react-dom/server` |
| `tests/printOutputControl.test.ts` | 87 | `../services/printer/NativePrintBridge`, `../services/printer/PrintFeedback`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/privateRealtimeProductionFlag.test.ts` | 54 | `../services/sync/SyncFeatureFlags`, `node:assert/strict`, `node:fs/promises`, `node:test` |
| `tests/productEditorLayout.test.ts` | 75 | `../utils/productEditorSummary`, `../utils/productEditorTabs`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/productEditorSync.test.ts` | 39 | `../utils/productEditorSync`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/productItemTypeLabelContract.test.ts` | 19 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/productModifierSuggestion.test.ts` | 128 | `../components/ProductForm`, `node:assert/strict`, `node:test` |
| `tests/productTaxSnapshot.test.ts` | 26 | `../services/sync/ProductImageCacheService`, `node:assert/strict`, `node:test` |
| `tests/productionOutputMode.test.ts` | 31 | `../utils/productionOutputMode`, `node:assert/strict`, `node:test` |
| `tests/productionRoutingAssignment.test.ts` | 133 | `../utils/productionRoutingAssignment`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/realtimeNotificationScope.test.ts` | 46 | `../services/sync/RealtimeHintScope`, `node:assert/strict`, `node:test` |
| `tests/realtimePollingContract.test.ts` | 76 | `node:assert/strict`, `node:fs/promises`, `node:test` |
| `tests/receiptCouponPresentation.test.ts` | 22 | `../utils/receiptCouponPresentation`, `node:assert/strict`, `node:test` |
| `tests/receiptEmailPayload.test.ts` | 218 | `../services/email/receiptEmailPayload`, `../types`, `node:assert/strict`, `node:test` |
| `tests/receiptEmailService.test.ts` | 163 | `../services/email/receiptEmailService`, `node:assert/strict`, `node:test`, `uuid` |
| `tests/recoveryAtomicAdapters.test.ts` | 110 | `../services/db/adapters/CapacitorSQLiteAdapter`, `../services/db/adapters/IndexedDBAdapter`, `fake-indexeddb`, `node:assert/strict`, `node:sqlite`, `node:test` |
| `tests/recoveryAutomatic.test.ts` | 95 | `../services/recovery/AutomaticRecovery`, `./helpers/closePreparationSQLite`, `node:assert/strict`, `node:test` |
| `tests/recoveryAvailability.test.ts` | 86 | `../services/recovery/RecoveryAvailability`, `node:assert/strict`, `node:test` |
| `tests/recoveryCanonicalJson.test.ts` | 13 | `../services/recovery/RecoveryJson`, `node:assert/strict`, `node:test` |
| `tests/recoveryCashTransport.test.ts` | 80 | `../services/recovery/OriginalCodec`, `../services/recovery/RecoveryDatabase`, `../services/sync/erpOutboundPayloads`, `./helpers/closePreparationSQLite`, `node:assert/strict`, `node:test` |
| `tests/recoveryCompleteOriginals.test.ts` | 209 | `../services/recovery/NativeZReport`, `../services/recovery/OriginalCodec`, `../services/recovery/PendingOperationsRecovery`, `../services/recovery/ReceivedCloseFlow`, `../services/recovery/RecoveryCloseController`, `./fixtures/nativeRecoveryOperations`, `./helpers/closePreparationSQLite`, `node:assert/strict`, `node:test` |
| `tests/recoveryDurableRoundTrip.test.ts` | 723 | `../services/db/adapters/CapacitorSQLiteAdapter`, `../services/recovery/OriginalCapture`, `../services/recovery/PendingOperationsRecovery`, `../services/recovery/RecoveryDatabase`, `../services/sync/erpOutboundPayloads`, `../utils/analytics`, `../utils/closeReportOptions`, `../utils/zReportPaymentSummary`, `express`, `node:assert/strict`, `node:events`, `node:fs/promises`, `node:net`, `node:os`, `node:path`, `node:sqlite`, `node:test`, `node:url` |
| `tests/recoveryEpochIntegration.test.ts` | 241 | `../services/recovery/PendingOperationsRecovery`, `./helpers/closePreparationSQLite`, `node:assert/strict`, `node:fs/promises`, `node:net`, `node:os`, `node:path`, `node:test`, `node:url` |
| `tests/recoveryErpTransport.test.ts` | 175 | `../services/recovery/OriginalCodec`, `../services/recovery/PendingOperationsRecovery`, `express`, `node:assert/strict`, `node:crypto`, `node:events`, `node:test`, `node:url` |
| `tests/recoveryNativeOperationsRoundTrip.test.ts` | 382 | `../services/recovery/NativeZReport`, `../services/recovery/OriginalCodec`, `../services/recovery/PendingOperationsRecovery`, `../services/recovery/ReceivedCloseFlow`, `../services/recovery/RecoveryCloseController`, `../services/recovery/RecoveryJson`, `./fixtures/nativeRecoveryOperations`, `./helpers/closePreparationSQLite`, `node:assert/strict`, `node:fs/promises`, `node:module`, `node:net`, `node:os`, `node:path`, `node:test`, `node:url` |
| `tests/recoveryNativePacket.test.ts` | 406 | `../services/recovery/ClosePreparation`, `../services/recovery/OriginalCodec`, `./helpers/closePreparationSQLite`, `node:assert/strict`, `node:fs/promises`, `node:net`, `node:os`, `node:path`, `node:test`, `node:url` |
| `tests/recoveryNumberConflict.test.ts` | 218 | `../services/recovery/OriginalCodec`, `../services/recovery/ReceivedCloseFlow`, `../services/recovery/RecoveryJson`, `./helpers/closePreparationSQLite`, `node:assert/strict`, `node:test` |
| `tests/recoveryReceivedCloseRoundTrip.test.ts` | 665 | `../services/recovery/NativeZReport`, `../services/recovery/OriginalCodec`, `../services/recovery/PendingOperationsRecovery`, `../services/recovery/ReceivedCloseFlow`, `../services/recovery/RecoveryCloseController`, `./helpers/closePreparationSQLite`, `node:assert/strict`, `node:fs/promises`, `node:module`, `node:net`, `node:os`, `node:path`, `node:test`, `node:url` |
| `tests/recoveryRetainedEpoch.test.ts` | 157 | `../services/recovery/RetainedEpoch`, `./helpers/closePreparationSQLite`, `node:assert/strict`, `node:test` |
| `tests/recoveryRetainedOriginals.test.ts` | 92 | `../services/recovery/OriginalCodec`, `../services/recovery/RetainedOriginals`, `./helpers/closePreparationSQLite`, `node:assert/strict`, `node:test` |
| `tests/recoveryRetainedSet.test.ts` | 363 | `../services/recovery/OriginalCodec`, `../services/recovery/PendingOperationsRecovery`, `../services/recovery/RecoveryJson`, `../services/recovery/RetainedCaptureSet`, `../services/recovery/RetainedOriginals`, `../services/recovery/RetainedRestore`, `./helpers/closePreparationSQLite`, `node:assert/strict`, `node:test`, `node:url` |
| `tests/recoveryUuid.test.ts` | 16 | `../services/recovery/RecoveryUuid`, `node:assert/strict`, `node:test` |
| `tests/recoveryWebViewCompatibility.test.ts` | 22 | `../services/recovery/NativeZConfiguration`, `../services/recovery/RecoveryJson`, `node:assert/strict`, `node:test` |
| `tests/refundAvailability.test.ts` | 78 | `../types`, `../utils/refundAvailability`, `node:assert/strict`, `node:test` |
| `tests/restaurantClientConsistencyContract.test.ts` | 94 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/restaurantDirectSaleNavigation.test.ts` | 30 | `../utils/restaurantNavigation`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/restaurantHotReversal.test.ts` | 50 | `../utils/restaurantHotReversal`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/runAutomaticCatalogSaves.mjs` | 14 | `esbuild`, `node:child_process`, `node:fs/promises`, `node:path` |
| `tests/salePostedContract.test.ts` | 229 | `../services/sync/SalePostedContract`, `../utils/fiscalBreakdown`, `node:assert/strict`, `node:test` |
| `tests/secureTerminalRebindContract.test.ts` | 59 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/serviceTaxPolicy.test.ts` | 140 | `../constants`, `../types`, `../utils/fiscalBreakdown`, `../utils/orderServiceType`, `../utils/serviceTaxPolicy`, `../utils/terminalConfigSnapshot`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/serviceTypeSettingsContract.test.ts` | 45 | `../constants`, `../types`, `../utils/serviceTaxPolicy`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/setupInitialConfigTimeoutContract.test.ts` | 54 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/startupConfigEvents.test.ts` | 41 | `node:assert/strict`, `node:fs`, `node:test`, `node:vm`, `typescript` |
| `tests/startupConfigTimeout.test.ts` | 47 | `../services/network/fetchAndReadWithTimeout`, `node:assert/strict`, `node:test` |
| `tests/startupSecuritySnapshot.test.ts` | 136 | `node:assert/strict`, `node:fs`, `node:test`, `node:vm`, `typescript` |
| `tests/startupTrace.test.ts` | 29 | `../utils/startupTrace`, `node:assert/strict`, `node:test` |
| `tests/subtotalizedTicketPermissionContract.test.ts` | 54 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/supermarketTicketLayout.test.ts` | 56 | `../components/ActionGrid`, `../components/SupermarketTicketSummary`, `../types`, `node:assert/strict`, `node:fs`, `node:test`, `react`, `react-dom/server` |
| `tests/syncErrorDiagnostic.test.ts` | 154 | `../services/sync/SyncErrorDiagnostic`, `node:assert/strict`, `node:test` |
| `tests/syncInactivityPolicy.test.ts` | 30 | `../utils/syncInactivityPolicy`, `node:assert/strict`, `node:test` |
| `tests/syncLegacyEndpointAuth.test.ts` | 57 | `node:assert/strict`, `node:fs/promises`, `node:test` |
| `tests/syncMetrics.test.ts` | 47 | `../services/sync/SyncMetrics`, `node:assert/strict`, `node:test` |
| `tests/syncMonitorLocalLoad.test.ts` | 95 | `node:assert/strict`, `node:fs`, `node:test`, `typescript` |
| `tests/syncMonitorPage.test.ts` | 80 | `../services/db/SyncMonitorPage`, `better-sqlite3`, `node:assert/strict`, `node:test` |
| `tests/syncMonitorResolvedCatalogEdits.test.ts` | 10 | `../services/db/SyncMonitorPage`, `node:assert/strict`, `node:test` |
| `tests/syncTriggerCoordinator.test.ts` | 114 | `../services/sync/SyncTriggerCoordinator`, `node:assert/strict`, `node:test` |
| `tests/tableAccessPolicy.test.ts` | 26 | `../utils/tableAccessPolicy`, `node:assert/strict`, `node:test` |
| `tests/tableAccountModalContract.test.ts` | 34 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/tableAccountModalLockContract.test.ts` | 31 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/tableAccountPresentation.test.ts` | 81 | `../types`, `../utils/paymentFractions`, `../utils/tableAccountPresentation`, `node:assert/strict`, `node:test` |
| `tests/tableChairs.test.ts` | 19 | `../utils/tableChairs`, `node:assert/strict`, `node:test` |
| `tests/tableLayout.test.ts` | 212 | `../types`, `../utils/tableLayout`, `node:assert/strict`, `node:test` |
| `tests/tableLayoutDesignerContract.test.ts` | 25 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/tableMapCardDensity.test.ts` | 28 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/tableMapCloseDiagnostics.test.ts` | 34 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/tableMapOpenPerformanceContract.test.ts` | 56 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/tableMapXReportContract.test.ts` | 12 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/tableMotionPolicy.test.ts` | 27 | `../utils/tableMotionPolicy`, `node:assert/strict`, `node:test` |
| `tests/tableMove.test.ts` | 47 | `../components/TableMoveConfirmationModal`, `../types`, `node:assert/strict`, `node:test` |
| `tests/tableMoveDestinationContract.test.ts` | 29 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/tablePaymentClosureContract.test.ts` | 23 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/tableSwitchLocalUnlockHotfix.test.ts` | 108 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/tabletNavigation.test.tsx` | 37 | `../components/MobilePosNavigation`, `../hooks/useIsMobile`, `node:assert/strict`, `node:test`, `react`, `react-dom/server` |
| `tests/taxBreakdownDisplay.test.ts` | 78 | `../services/printer/EscPosFormatter`, `../utils/fiscalBreakdown`, `node:assert/strict`, `node:test` |
| `tests/taxIdentity.test.ts` | 84 | `../utils/taxIdentity`, `node:assert/strict`, `node:test` |
| `tests/teamHubAccess.test.ts` | 18 | `../utils/teamHubAccess`, `node:assert/strict`, `node:test` |
| `tests/temporalDiagnostics.test.ts` | 130 | `../diagnostics/viteInstrumentation`, `esbuild`, `node:assert/strict`, `node:child_process`, `node:fs`, `node:os`, `node:path`, `node:test` |
| `tests/terminalAuthorizationGuard.test.ts` | 105 | `../utils/terminalAuthorizationGuard`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/terminalBindingHierarchy.test.ts` | 106 | `../utils/terminalBindingHierarchy`, `node:assert/strict`, `node:test` |
| `tests/terminalCompanyInfoSnapshot.test.ts` | 180 | `../constants`, `../utils/terminalConfigSnapshot`, `node:assert/strict`, `node:test` |
| `tests/terminalConfigRequestCoordinator.test.ts` | 150 | `../services/sync/TerminalConfigRequestCoordinator`, `node:assert/strict`, `node:test` |
| `tests/terminalDeviceRequests.test.ts` | 54 | `../services/setup/terminalDeviceRequests`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/terminalDocumentValidation.test.ts` | 88 | `../utils/seriesValidation`, `../utils/validation`, `node:assert/strict`, `node:test` |
| `tests/terminalModeSelectorResponsiveContract.test.ts` | 18 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/terminalRegistrationIdentity.test.ts` | 55 | `../services/sync/erpRegisterResponse`, `node:assert/strict`, `node:test` |
| `tests/terminalUpgradePersistence.test.ts` | 51 | `node:assert/strict`, `node:fs`, `node:path`, `node:test` |
| `tests/transactionHistoryPresentation.test.ts` | 37 | `../utils/transactionHistoryPresentation`, `node:assert/strict`, `node:test` |
| `tests/transferReceiptService.test.ts` | 217 | `../services/sync/TransferReceiptService`, `../types`, `node:assert/strict`, `node:test` |
| `tests/userSalesPolicy.test.ts` | 36 | `../types`, `../utils/userSalesPolicy`, `node:assert/strict`, `node:test` |
| `tests/variantPromotionCapability.test.ts` | 19 | `../utils/syncCapabilities`, `node:assert/strict`, `node:test` |
| `tests/variantPromotionContract.test.ts` | 102 | `../services/sync/sourceIdentity`, `../types`, `../utils/terminalConfigSnapshot`, `node:assert/strict`, `node:test` |
| `tests/variantPromotionEngine.test.ts` | 128 | `../types`, `../utils/promotionEngine`, `node:assert/strict`, `node:test` |
| `tests/variantSalesPrice.test.ts` | 28 | `../types`, `../utils/variantSalesPrice`, `node:assert/strict`, `node:test` |
| `tests/webviewObjectCompatibility.test.ts` | 16 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/zReportDeclarationScreen.test.ts` | 38 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/zReportEmailService.test.ts` | 285 | `../services/email/zReportEmailService`, `../types`, `node:assert/strict`, `node:test` |
| `tests/zReportPaymentSummary.test.ts` | 81 | `../services/printer/EscPosFormatter`, `../services/printer/templates/ZReportReceipt`, `../types`, `../utils/zReportPaymentSummary`, `node:assert/strict`, `node:fs`, `node:test` |
| `tests/zReportSequenceContinuity.test.ts` | 159 | `../services/zreports/ZReportSequenceContinuity`, `../types`, `../utils/documentSeriesIdentity`, `node:assert/strict`, `node:test` |
| `tests/zReportSyncRetry.test.ts` | 217 | `node:assert/strict`, `node:fs`, `node:test` |
| `tests/zReportTerminalName.test.ts` | 50 | `../services/printer/EscPosFormatter`, `../services/printer/templates/ZReportReceipt`, `node:assert/strict`, `node:test` |
| `types.ts` | 3238 | — |
| `types/importExport.ts` | 31 | — |
| `types/native-printer.d.ts` | 18 | `../services/printer/NativePrintContract` |
| `utils/ExportUtils.ts` | 68 | — |
| `utils/analytics.ts` | 117 | `../types` |
| `utils/backgroundSyncScheduler.ts` | 58 | `./operatorUiTransition`, `./posSaleActivity` |
| `utils/barcodeParser.ts` | 94 | `../types` |
| `utils/cameraCapability.ts` | 34 | `../types` |
| `utils/cameraSelection.ts` | 20 | — |
| `utils/cartItemEditPermissions.ts` | 44 | `../types` |
| `utils/cartQuantity.ts` | 19 | — |
| `utils/categoryOptions.ts` | 44 | — |
| `utils/closeReceiptSummary.ts` | 95 | `../types` |
| `utils/closeReportOptions.ts` | 153 | `../types`, `./fiscalBreakdown` |
| `utils/cloudMasterRegistry.ts` | 696 | `./erpBaseUrl`, `./supabase`, `./tenantIdentityStorage` |
| `utils/collectionSettlement.ts` | 72 | `../types` |
| `utils/couponScan.ts` | 21 | — |
| `utils/couponService.ts` | 197 | `../types`, `./uuid` |
| `utils/creditRules.ts` | 87 | `../types` |
| `utils/customerDisplay.ts` | 384 | `../types`, `./media` |
| `utils/dateUtils.ts` | 63 | — |
| `utils/db.ts` | 1976 | `../constants`, `../services/db`, `../services/sync/PermissionService`, `../types`, `./documentSeriesIdentity`, `./fiscalPreparedAuthority`, `@capacitor/core` |
| `utils/deviceProfile.ts` | 153 | `../types` |
| `utils/deviceRevocation.ts` | 212 | `@capacitor/preferences` |
| `utils/deviceRoleHelpers.ts` | 381 | `../types` |
| `utils/documentSeriesIdentity.ts` | 318 | `../types` |
| `utils/email.ts` | 96 | `../types` |
| `utils/entityImage.ts` | 63 | `../types`, `@capacitor/core` |
| `utils/erpBaseUrl.ts` | 75 | `@capacitor/core` |
| `utils/erpFiscalCatalogSync.ts` | 117 | `../types`, `./taxIdentity` |
| `utils/erpHeartbeatScheduler.ts` | 103 | — |
| `utils/erpPaymentMethods.ts` | 57 | `../types` |
| `utils/erpSecuritySnapshot.ts` | 212 | `../types`, `./userSalesPolicy` |
| `utils/erpSyncLifecycle.ts` | 2874 | `../constants`, `../services/db`, `../services/sync/AuthenticatedActivityTracker`, `../services/sync/ErpMasterSyncContract`, `../services/sync/MasterNumberRangeService`, `../services/sync/ProductImageCacheService`, `../services/sync/SyncErrorDiagnostic`, `../services/sync/SyncMetrics`, `../services/sync/TerminalCredentialStore`, `../services/sync/deviceToken`, `../services/sync/erpRegisterResponse`, `../services/sync/masterNumberRangeContract`, `../services/sync/terminalIdentity`, `../types`, `./db`, `./deviceProfile`, `./deviceRevocation`, `./deviceRoleHelpers`, `./erpBaseUrl`, `./erpFiscalCatalogSync`, `./orderTakerPolicy`, `./syncCapabilities`, `./tenantIdentityStorage`, `./terminalConfigPushScopes`, `./terminalConfigSnapshot` |
| `utils/fiscal/fiscalHelpers.ts` | 705 | `../../types` |
| `utils/fiscalBreakdown.ts` | 466 | `../types`, `./taxIdentity` |
| `utils/fiscalExcel.ts` | 1344 | `../types`, `@capacitor/core`, `@capacitor/filesystem`, `xlsx` |
| `utils/fiscalPreparedAuthority.ts` | 41 | `../types` |
| `utils/format.ts` | 8 | — |
| `utils/globalBarcodeCapture.ts` | 152 | — |
| `utils/globalDiscountPresentation.ts` | 34 | — |
| `utils/importParser.ts` | 42 | `papaparse` |
| `utils/interactionPerformance.ts` | 341 | `../diagnostics/runtime` |
| `utils/inventoryEngine.ts` | 380 | `../types`, `./db`, `./units` |
| `utils/inventoryProductSearch.ts` | 68 | `../types`, `./productReferences` |
| `utils/inventoryScanner.ts` | 17 | — |
| `utils/kdsPresentation.ts` | 26 | `../types` |
| `utils/kdsRouting.ts` | 314 | `../types`, `./deviceRoleHelpers` |
| `utils/labelPrinter.ts` | 291 | `../services/printer/EscPosFormatter`, `../services/printer/NativePrintBridge`, `../services/printer/OfflinePrintQueueService`, `../services/printer/PrintFeedback`, `../services/printer/PrintRouterService`, `../services/printer/PrintRuntime`, `../types` |
| `utils/licenseGuard.ts` | 674 | `./erpBaseUrl`, `./erpSyncLifecycle`, `./supabase` |
| `utils/lineDiscountPresentation.ts` | 45 | — |
| `utils/loyaltyEngine.ts` | 96 | `../types` |
| `utils/masterIdentity.ts` | 288 | `../types` |
| `utils/masterLanDiscovery.ts` | 71 | `../services/sync/NetworkScanner`, `./cloudMasterRegistry` |
| `utils/masterOperationalApi.ts` | 236 | `../types`, `./masterServerEligibility`, `@capacitor/core` |
| `utils/masterServerEligibility.ts` | 119 | `../types`, `./deviceRoleHelpers` |
| `utils/media.ts` | 33 | `../types` |
| `utils/nativeSessionResume.ts` | 40 | — |
| `utils/numericInput.ts` | 37 | — |
| `utils/operatorUiTransition.ts` | 57 | — |
| `utils/orderServiceType.ts` | 111 | `../types` |
| `utils/orderTakerPolicy.ts` | 125 | — |
| `utils/paymentFractions.ts` | 45 | `../types` |
| `utils/paymentSettlement.ts` | 358 | `../types`, `./creditRules` |
| `utils/posCatalogDebugTrace.ts` | 114 | `./db` |
| `utils/posCatalogPresentation.ts` | 136 | `../types` |
| `utils/posCategoryGrid.ts` | 19 | — |
| `utils/posMasterCatalogContract.ts` | 89 | `../types` |
| `utils/posSaleActivity.ts` | 88 | — |
| `utils/posStartupView.ts` | 33 | `../types` |
| `utils/posTableHeader.ts` | 34 | — |
| `utils/posUserReconciliation.ts` | 197 | `../types` |
| `utils/pricing.ts` | 16 | — |
| `utils/printCopies.ts` | 31 | `../types` |
| `utils/printer.ts` | 1276 | `../services/CheckoutPrintTracking`, `../services/db`, `../services/printer/BrowserPrint`, `../services/printer/EscPosFormatter`, `../services/printer/PrintFeedback`, `../services/printer/PrintRouterService`, `../services/printer/PrintRuntime`, `../types`, `./fiscalBreakdown`, `./globalDiscountPresentation`, `./lineDiscountPresentation`, `./paymentSettlement`, `./printCopies`, `./receiptCouponPresentation`, `./receiptVariant`, `./terminalSnapshotSellers` |
| `utils/productEditorSummary.ts` | 17 | — |
| `utils/productEditorSync.ts` | 31 | `../types` |
| `utils/productEditorTabs.ts` | 18 | — |
| `utils/productReferences.ts` | 438 | `../types` |
| `utils/productSeedPacks.ts` | 195 | `../types` |
| `utils/productionOutputMode.ts` | 32 | — |
| `utils/productionRoutingAssignment.ts` | 54 | `../types`, `./restaurantProductConfig` |
| `utils/promotionAnalytics.ts` | 59 | `../types` |
| `utils/promotionEngine.ts` | 845 | `../types`, `./productReferences` |
| `utils/receiptCouponPresentation.ts` | 29 | `../types` |
| `utils/receiptVariant.ts` | 17 | — |
| `utils/refundAvailability.ts` | 100 | `../types` |
| `utils/restaurantHotReversal.ts` | 69 | — |
| `utils/restaurantNavigation.ts` | 4 | — |
| `utils/restaurantProductConfig.ts` | 109 | `../types` |
| `utils/seriesValidation.ts` | 160 | `../types`, `./documentSeriesIdentity` |
| `utils/serviceTaxPolicy.ts` | 176 | `../types` |
| `utils/session.ts` | 39 | `../types` |
| `utils/startupTrace.ts` | 27 | — |
| `utils/supabase.ts` | 76 | `@supabase/supabase-js` |
| `utils/syncCapabilities.ts` | 11 | — |
| `utils/syncInactivityPolicy.ts` | 50 | — |
| `utils/tableAccessPolicy.ts` | 30 | `../types` |
| `utils/tableAccountPresentation.ts` | 102 | `../types`, `./paymentFractions` |
| `utils/tableChairs.ts` | 14 | — |
| `utils/tableLayout.ts` | 301 | `../types` |
| `utils/tableMotionPolicy.ts` | 17 | — |
| `utils/tableTicketIntegrity.ts` | 34 | `../types` |
| `utils/taxIdentity.ts` | 105 | `../types` |
| `utils/taxSummary.ts` | 72 | `../types`, `./taxIdentity` |
| `utils/teamHubAccess.ts` | 16 | — |
| `utils/tenantIdentityStorage.ts` | 48 | — |
| `utils/terminalAuthorizationGuard.ts` | 191 | — |
| `utils/terminalBindingHierarchy.ts` | 226 | — |
| `utils/terminalConfigPushScopes.ts` | 227 | — |
| `utils/terminalConfigSnapshot.ts` | 2861 | `../constants`, `../types`, `./deviceProfile`, `./deviceRoleHelpers`, `./documentSeriesIdentity`, `./fiscal/fiscalHelpers`, `./masterIdentity`, `./orderTakerPolicy`, `./serviceTaxPolicy` |
| `utils/terminalLoginLabel.ts` | 6 | — |
| `utils/terminalSnapshotSellers.ts` | 87 | `../types` |
| `utils/transactionHistoryPresentation.ts` | 62 | `../types` |
| `utils/unitConversions.ts` | 69 | — |
| `utils/units.ts` | 68 | — |
| `utils/userSalesPolicy.ts` | 41 | `../types` |
| `utils/uuid.ts` | 32 | — |
| `utils/validation.ts` | 142 | `../types`, `./documentSeriesIdentity`, `./masterIdentity` |
| `utils/variantSalesPrice.ts` | 16 | `../types` |
| `utils/visorSync.ts` | 223 | `../types` |
| `utils/zReportPaymentSummary.ts` | 112 | `../types`, `./creditRules`, `./paymentSettlement` |
| `vite-env.d.ts` | 1 | — |
| `vite.config.ts` | 163 | `./diagnostics/viteInstrumentation`, `@vitejs/plugin-react`, `fs`, `path`, `vite` |
