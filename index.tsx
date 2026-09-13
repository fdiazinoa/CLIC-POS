declare const __POS_DIAGNOSTIC_BUILD__: boolean;
async function bootstrap() {
  if (__POS_DIAGNOSTIC_BUILD__) { const {installDiagnostics}=await import('./diagnostics/runtime'); await installDiagnostics(); }
  await import('./bootstrap');
}
void bootstrap();
