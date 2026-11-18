import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

/** Saves only the generated audit report, never the database or credentials. No network calls. */
export async function saveBaselineReferenceInventory(json: string): Promise<string> {
  const fileName = `clic-v3-inventario-local-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
  if (Capacitor.isNativePlatform()) {
    await Filesystem.writeFile({ path: `Download/${fileName}`, data: json, directory: Directory.Documents, encoding: Encoding.UTF8, recursive: true });
    return `Documents/Download/${fileName}`;
  }
  const url = URL.createObjectURL(new Blob([json], {type:'application/json'}));
  try {
    const link = document.createElement('a'); link.href=url; link.download=fileName;
    document.body.appendChild(link); link.click(); link.remove();
  } finally { window.setTimeout(()=>URL.revokeObjectURL(url),1000); }
  return fileName;
}
