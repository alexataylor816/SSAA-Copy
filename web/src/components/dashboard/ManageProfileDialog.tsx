import { useEffect, useRef, useState } from "react";
import { BadgeCheck, Camera, Globe, KeyRound, Loader2, Mail, Phone, User } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { authApi } from "@/lib/api";
import { getToken } from "@/lib/supabase";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Lovable's ManageProfileModal, on the profile endpoints opencode added (PATCH /auth/profile, POST /uploads). */

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("") || "?";

function FieldLabel({ icon: Icon, htmlFor, children }: { icon: typeof User; htmlFor: string; children: React.ReactNode }) {
  return (
    <Label htmlFor={htmlFor} className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      {children}
    </Label>
  );
}

export default function ManageProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user, refreshProfile } = useAuth();
  const { language, setLanguage } = useLanguage();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [lang, setLang] = useState(language);
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [hasEmployeeRecord, setHasEmployeeRecord] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  // Start from the saved profile every time the dialog opens.
  useEffect(() => {
    if (!open || !user) return;
    setName(user.fullName ?? "");
    setPhone(user.phone ?? "");
    setPhoto(user.profilePictureUrl ?? null);
    setLang(language);
    setShowPassword(false);
    setCurrentPassword("");
    setNewPassword("");
    authApi
      .getProfile()
      .then((res) => {
        setEmployeeNumber(res.employeeNumber ?? "");
        setHasEmployeeRecord(res.hasEmployeeRecord);
      })
      .catch(() => setHasEmployeeRecord(false));
  }, [open, user, language]);

  async function uploadPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("photo", file);
      form.append("folder", "avatars");
      const token = getToken();
      const res = await fetch("/api/uploads", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      const payload = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !payload.url) throw new Error(payload.error ?? "Upload failed.");
      setPhoto(payload.url);
    } catch (err) {
      toast({ title: "Could not upload that photo", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!name.trim()) {
      toast({ title: "Full name is required", variant: "destructive" });
      return;
    }
    if (showPassword && (currentPassword || newPassword) && (!currentPassword || newPassword.length < 6)) {
      toast({ title: "Enter your current password and a new one of at least 6 characters", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await authApi.updateProfile({
        fullName: name.trim(),
        phone: phone.trim() || null,
        language: lang,
        profilePictureUrl: photo,
        ...(hasEmployeeRecord ? { employeeNumber: employeeNumber.trim() || null } : {}),
      });
      if (showPassword && currentPassword && newPassword) {
        await authApi.changePassword({ currentPassword, newPassword });
      }
      setLanguage(lang);
      await refreshProfile();
      toast({ title: "Profile updated" });
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Could not save your profile", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-md flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Manage My Profile
          </DialogTitle>
          <DialogDescription>Update your personal information</DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex-1 space-y-5 overflow-y-auto px-1">
          <div className="flex flex-col items-center gap-3">
            <div className="relative">
              {photo ? (
                <img src={photo} alt="" className="h-20 w-20 rounded-full border-2 border-primary/20 object-cover" />
              ) : (
                <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-primary/20 bg-primary/10 text-xl font-semibold text-primary">
                  {initials(name || user?.email || "")}
                </div>
              )}
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow"
                aria-label="Change photo"
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              </button>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {photo ? "Change Photo" : "Add Photo"}
              </Button>
              {photo && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setPhoto(null)}>
                  Remove
                </Button>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void uploadPhoto(e)} />
          </div>

          <div className="space-y-2">
            <FieldLabel icon={User} htmlFor="profile-name">
              Full Name
            </FieldLabel>
            <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-2">
            <FieldLabel icon={Mail} htmlFor="profile-email">
              Email
            </FieldLabel>
            <Input id="profile-email" value={user?.email ?? ""} disabled />
          </div>

          <div className="space-y-2">
            <FieldLabel icon={Phone} htmlFor="profile-phone">
              Phone Number
            </FieldLabel>
            <Input id="profile-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Enter phone number" />
          </div>

          {hasEmployeeRecord && (
            <div className="space-y-2">
              <FieldLabel icon={BadgeCheck} htmlFor="profile-employee-id">
                Employee ID <span className="text-xs font-normal text-muted-foreground">(optional)</span>
              </FieldLabel>
              <Input
                id="profile-employee-id"
                value={employeeNumber}
                onChange={(e) => setEmployeeNumber(e.target.value)}
                placeholder="e.g. EMP-1234"
                maxLength={40}
              />
              <p className="text-xs text-muted-foreground">Optional payroll/HR identifier. Shown on timesheet exports only.</p>
            </div>
          )}

          <div className="space-y-2">
            <FieldLabel icon={Globe} htmlFor="profile-language">
              Language
            </FieldLabel>
            <select
              id="profile-language"
              value={lang}
              onChange={(e) => setLang(e.target.value as typeof lang)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="en">English</option>
              <option value="es">Español</option>
            </select>
          </div>

          <div className="rounded-md border">
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium hover:bg-accent"
              aria-expanded={showPassword}
            >
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              Change password
            </button>
            {showPassword && (
              <div className="space-y-3 border-t p-3">
                <div className="space-y-1">
                  <Label htmlFor="profile-current-password" className="text-xs">
                    Current password
                  </Label>
                  <Input
                    id="profile-current-password"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="profile-new-password" className="text-xs">
                    New password
                  </Label>
                  <Input
                    id="profile-new-password"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={() => void save()} disabled={saving || uploading}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
