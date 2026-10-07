import React, { useState } from 'react';
import { Fingerprint, X } from 'lucide-react';
import type { User } from '../types';
import { biometricService } from '../services/BiometricAuthService';
import { currentProfileTenant, LOCAL_USER_PROFILE_CHANGED, saveLocalUserProfile } from '../utils/localUserProfiles';

export default function LocalUserProfileModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [tenantId] = useState(currentProfileTenant);
  const [photo, setPhoto] = useState(user.photo);
  const [biometrics, setBiometrics] = useState(user.biometrics);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selectPhoto = async (file?: File) => {
    if (!file) return;
    setError('');
    if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) {
      setError('Selecciona una imagen de hasta 10 MB.'); return;
    }
    setBusy(true);
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url; await image.decode();
      const scale = Math.min(1, 384 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No se pudo procesar la foto.');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      setPhoto(canvas.toDataURL('image/jpeg', 0.85));
    } catch { setError('No se pudo leer la imagen. Prueba otra foto.'); }
    finally { URL.revokeObjectURL(url); setBusy(false); }
  };
  const enroll = async () => {
    setBusy(true); setError('');
    try {
      if (!await biometricService.isAvailable()) throw new Error('No hay biometría compatible disponible en este dispositivo.');
      const credential = await biometricService.register(user);
      if (!credential) throw new Error('La captura no se completó.');
      setBiometrics({ ...credential, registeredAt: new Date().toISOString() });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo registrar la huella.'); }
    finally { setBusy(false); }
  };
  const save = () => {
    try {
      if (tenantId !== currentProfileTenant()) throw new Error('El negocio cambió. Cierra y vuelve a abrir este usuario.');
      saveLocalUserProfile(user.id, { photo, biometrics }, tenantId);
      window.dispatchEvent(new Event(LOCAL_USER_PROFILE_CHANGED)); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar el perfil local.'); }
  };
  return <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="local-profile-title" className="bg-white rounded-2xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
      <div className="flex justify-between items-center gap-3">
        <h3 id="local-profile-title" className="font-bold text-xl">Foto y huella local</h3>
        <button aria-label="Cerrar" disabled={busy} onClick={onClose}><X /></button>
      </div>
      <p className="font-bold mt-3">{user.name}</p>
      <p className="text-sm text-gray-500 mt-2">Se guardan en este dispositivo. Nombre, PIN y permisos conservan su configuración de origen.</p>
      {photo && <img src={photo} alt={`Foto de ${user.name}`} className="w-24 h-24 rounded-full object-cover my-4" />}
      <label className="block mt-5 font-bold text-sm">Foto de perfil
        <input type="file" accept="image/*" disabled={busy} onChange={e => void selectPhoto(e.target.files?.[0])} className="block w-full mt-2 text-sm" />
      </label>
      <button disabled={busy} onClick={() => void enroll()} className="mt-6 p-3 bg-blue-50 text-blue-800 rounded-xl flex gap-2 items-center font-bold disabled:opacity-50">
        <Fingerprint /> {biometrics ? 'Volver a registrar huella' : 'Registrar huella'}
      </button>
      <p className="mt-2 text-xs text-gray-500">{biometrics ? 'Credencial biométrica registrada.' : 'Requiere biometría compatible habilitada en el equipo.'}</p>
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      <div className="flex gap-3 mt-6">
        <button disabled={busy} onClick={onClose} className="flex-1 py-3 rounded-xl bg-gray-100">Cancelar</button>
        <button disabled={busy} onClick={save} className="flex-1 py-3 rounded-xl bg-indigo-600 text-white font-bold disabled:opacity-50">{busy ? 'Procesando…' : 'Guardar localmente'}</button>
      </div>
    </section>
  </div>;
}
