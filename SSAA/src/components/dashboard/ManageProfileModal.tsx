import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { User, Phone, Mail, Globe, Lock, ShieldAlert, Camera, Trash2 } from 'lucide-react';
import type { Language } from '@/i18n/translations';
import ChangePasswordModal from './ChangePasswordModal';
import ImmediatePasswordChangeModal from './ImmediatePasswordChangeModal';
import SmsConsentDialog from './SmsConsentDialog';

interface ImpersonatedUser {
  id: string;
  user_id: string;
  full_name: string | null;
  email: string;
  company_id: string | null;
  company_name: string | null;
  company_type: 'gc' | 'sub' | null;
}

interface ManageProfileModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  impersonatedUser?: ImpersonatedUser | null;
}

const ManageProfileModal = ({ open, onOpenChange, impersonatedUser }: ManageProfileModalProps) => {
  const { profile, user, isMOA, isMainOperator, isOMO, isReadOnlyOperator } = useAuth();
  const isOperatorTier = isOMO || isMainOperator || isReadOnlyOperator;
  const showImmediateChangeButton =
    (impersonatedUser && (isMainOperator || isOMO)) || (!impersonatedUser && isOperatorTier);
  const { t, language, setLanguage } = useLanguage();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState<Language>('en');
  const [showChangePasswordModal, setShowChangePasswordModal] = useState(false);
  const [showImmediateResetModal, setShowImmediateResetModal] = useState(false);
  const [profilePictureUrl, setProfilePictureUrl] = useState<string | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [linkedEmployeeId, setLinkedEmployeeId] = useState<string | null>(null);
  const [employeeIdValue, setEmployeeIdValue] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [companyIsGuest, setCompanyIsGuest] = useState(false);
  const [memberCount, setMemberCount] = useState<number>(1);
  const [originalPhoneDigits, setOriginalPhoneDigits] = useState<string>('');
  const [hadSmsConsent, setHadSmsConsent] = useState<boolean>(false);
  const [smsConsentDialogOpen, setSmsConsentDialogOpen] = useState(false);
  const [pendingPhoneConsent, setPendingPhoneConsent] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Hide Delete Account for MOA, for users without a real session profile,
  // and while an operator is impersonating someone else.
  const canShowDeleteAccount =
    !impersonatedUser && !!user && !!profile && profile.role !== 'moa';

  // Load company guest status + member count so we can pick the right warning copy.
  useEffect(() => {
    const loadDeletionContext = async () => {
      if (!canShowDeleteAccount || !profile?.company_id) {
        setCompanyIsGuest(false);
        setMemberCount(1);
        return;
      }
      const [{ data: companyRow }, { count }] = await Promise.all([
        supabase.from('companies').select('is_guest').eq('id', profile.company_id).maybeSingle(),
        supabase
          .from('profiles')
          .select('user_id', { count: 'exact', head: true })
          .eq('company_id', profile.company_id)
          .neq('role', 'moa'),
      ]);
      setCompanyIsGuest(!!companyRow?.is_guest);
      setMemberCount(count ?? 1);
    };
    if (open) loadDeletionContext();
  }, [open, canShowDeleteAccount, profile?.company_id]);

  const handleDeleteOwnAccount = async () => {
    setDeleteLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('delete-own-account');
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({
        title: 'Account deleted',
        description: 'Your profile has been permanently removed.',
      });
      await supabase.auth.signOut();
      navigate('/', { replace: true });
    } catch (err: any) {
      toast({
        title: 'Could not delete account',
        description: err?.message || 'Please try again or contact support.',
        variant: 'destructive',
      });
    } finally {
      setDeleteLoading(false);
      setDeleteDialogOpen(false);
    }
  };

  const isLastUser = memberCount <= 1;
  const deleteDialogTitle = isLastUser
    ? companyIsGuest
      ? "Delete your Guest Account?"
      : "Delete your company account?"
    : "Delete your profile?";
  const deleteDialogBody = isLastUser
    ? companyIsGuest
      ? "You're the last user on this Guest Account. Deleting your profile will also permanently delete the entire Guest Account, including its team and saved settings. Your projects will remain visible to the subcontractors you were connected with — only this Guest Account and its profiles are removed. This cannot be undone."
      : "You're the last user on this company account. Deleting your profile will also permanently delete the entire company account and all of its data. This cannot be undone."
    : "You're about to permanently delete your profile. You'll lose access to this account and won't be able to sign back in. This cannot be undone.";

  useEffect(() => {
    if (impersonatedUser) {
      setFullName(impersonatedUser.full_name || '');
      setEmail(impersonatedUser.email || '');
    } else if (profile) {
      setFullName(profile.full_name || '');
      setEmail(profile.email || '');
      setSelectedLanguage((profile.language as Language) || 'en');
    }
  }, [profile, impersonatedUser]);

  useEffect(() => {
    const fetchPermissions = async () => {
      const targetUserId = impersonatedUser?.user_id || user?.id;
      if (!targetUserId) return;
      
      const { data: profileData } = await supabase
        .from('profiles')
        .select('phone, language, profile_picture_url, sms_consent, sms_consent_phone')
        .eq('user_id', targetUserId)
        .single();
      
      const phoneDigits = (profileData?.phone || '').replace(/\D/g, '');
      setPhone(profileData?.phone || '');
      setOriginalPhoneDigits(phoneDigits);
      const consent = !!(profileData as any)?.sms_consent;
      const consentPhone = ((profileData as any)?.sms_consent_phone || '').replace(/\D/g, '');
      setHadSmsConsent(consent && consentPhone === phoneDigits && phoneDigits.length > 0);
      if (profileData?.language) {
        setSelectedLanguage(profileData.language as Language);
      }
      setProfilePictureUrl(profileData?.profile_picture_url || null);

      // Fetch linked employee record (if any) to read/write Employee ID
      const { data: empData } = await supabase
        .from('employees')
        .select('id, employee_id')
        .eq('linked_user_id', targetUserId)
        .maybeSingle();
      if (empData) {
        setLinkedEmployeeId(empData.id);
        setEmployeeIdValue(((empData as any).employee_id as string | null) || '');
      } else {
        setLinkedEmployeeId(null);
        setEmployeeIdValue('');
      }
    };

    if (open) {
      fetchPermissions();
    }
  }, [open, user, impersonatedUser]);

  const performSave = async (consentGranted: boolean) => {
    const targetProfileId = impersonatedUser?.id || profile?.id;
    if (!targetProfileId) return;
    const newPhoneDigits = phone.replace(/\D/g, '');

    setIsLoading(true);
    try {
      const updatePayload: any = {
        full_name: fullName,
        phone: newPhoneDigits,
        language: selectedLanguage,
      };
      if (consentGranted) {
        updatePayload.sms_consent = true;
        updatePayload.sms_consent_at = new Date().toISOString();
        updatePayload.sms_consent_phone = newPhoneDigits;
      }
      const { error } = await supabase
        .from('profiles')
        .update(updatePayload)
        .eq('id', targetProfileId);
      
      if (error) throw error;

      // Send welcome SMS on first opt-in
      if (consentGranted && newPhoneDigits.length > 0) {
        try {
          await supabase.functions.invoke('send-sms', {
            body: {
              event_type: 'sms_welcome_confirmation',
              recipient_phones: [newPhoneDigits],
              variables: {},
            },
          });
        } catch (smsErr) {
          console.error('Welcome SMS failed:', smsErr);
        }
      }

      // Persist optional Employee ID to linked employee record (if any)
      if (linkedEmployeeId) {
        await supabase
          .from('employees')
          .update({ employee_id: employeeIdValue.trim() || null } as any)
          .eq('id', linkedEmployeeId);
      }

      // Update app language context
      if (!impersonatedUser) {
        setLanguage(selectedLanguage);
      }

      const originalEmail = impersonatedUser?.email || profile?.email;
      const targetUserId = impersonatedUser?.user_id || user?.id;
      if (email !== originalEmail) {
        // Sync email to linked employee records
        if (targetUserId) {
          await supabase
            .from('employees')
            .update({ email })
            .eq('linked_user_id', targetUserId);
        }

        if (!impersonatedUser && user) {
          // User changing their own email - use auth API
          const { error: emailError } = await supabase.auth.updateUser({
            email: email,
          });
          if (emailError) throw emailError;
        } else if (impersonatedUser) {
          // MOA changing impersonated user's email - use edge function
          const { error: fnError } = await supabase.functions.invoke('update-auth-user-email', {
            body: { user_id: targetUserId, new_email: email },
          });
          if (fnError) throw fnError;
          
          // Also update profile email directly
          await supabase
            .from('profiles')
            .update({ email })
            .eq('user_id', targetUserId);
        }
      }
      
      toast({
        title: t('profile.updated'),
        description: t('profile.updatedDesc'),
      });
      onOpenChange(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    const newPhoneDigits = phone.replace(/\D/g, '');
    const phoneChanged = newPhoneDigits !== originalPhoneDigits;
    const needsConsent =
      !impersonatedUser &&
      newPhoneDigits.length > 0 &&
      (phoneChanged || !hadSmsConsent);
    if (needsConsent) {
      setSmsConsentDialogOpen(true);
      return;
    }
    await performSave(false);
  };
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const targetUserId = impersonatedUser?.user_id || user?.id;
    if (!targetUserId) return;

    setIsUploadingPhoto(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `users/${targetUserId}/avatar.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('profile-pictures')
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('profile-pictures').getPublicUrl(path);
      const url = `${urlData.publicUrl}?t=${Date.now()}`;
      
      await supabase.from('profiles').update({ profile_picture_url: url }).eq('user_id', targetUserId);
      setProfilePictureUrl(url);
      toast({ title: 'Photo updated' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleRemovePhoto = async () => {
    const targetUserId = impersonatedUser?.user_id || user?.id;
    if (!targetUserId) return;
    try {
      await supabase.from('profiles').update({ profile_picture_url: null }).eq('user_id', targetUserId);
      setProfilePictureUrl(null);
      toast({ title: 'Photo removed' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const displayTitle = impersonatedUser 
    ? `Manage Profile - ${impersonatedUser.full_name || impersonatedUser.email}`
    : 'Manage My Profile';

  const getInitials = (name: string) => {
    const parts = name.split(' ').filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    return name.substring(0, 2).toUpperCase();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              {displayTitle}
            </DialogTitle>
            <DialogDescription>
              Update {impersonatedUser ? 'user' : 'your personal'} information
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto overscroll-contain -mr-2 pr-2" style={{ WebkitOverflowScrolling: 'touch' }}>
            <div className="space-y-4 py-4 pr-2">
              {/* Profile Picture */}
              <div className="flex flex-col items-center gap-3">
                <div className="relative">
                  {profilePictureUrl ? (
                    <img src={profilePictureUrl} alt="Profile" className="w-20 h-20 rounded-full object-cover border-2 border-border" />
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xl font-semibold border-2 border-border">
                      {getInitials(fullName || 'U')}
                    </div>
                  )}
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:bg-primary/90 transition-colors"
                    disabled={isUploadingPhoto}
                  >
                    <Camera className="h-3.5 w-3.5" />
                  </button>
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={isUploadingPhoto}>
                    {isUploadingPhoto ? 'Uploading...' : profilePictureUrl ? 'Change Photo' : 'Add Photo'}
                  </Button>
                  {profilePictureUrl && (
                    <Button variant="ghost" size="sm" onClick={handleRemovePhoto}>
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      Remove
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="fullName" className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Full Name
                </Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Enter full name"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="email" className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter email"
                  disabled={!!impersonatedUser}
                />
                {impersonatedUser && (
                  <p className="text-xs text-muted-foreground">
                    Email can only be changed by the user themselves.
                  </p>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="phone" className="flex items-center gap-2">
                  <Phone className="h-4 w-4" />
                  Phone Number
                </Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Enter phone number"
                />
              </div>


              {linkedEmployeeId && (
                <div className="space-y-2">
                  <Label htmlFor="employeeIdValue" className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    Employee ID <span className="text-muted-foreground font-normal text-xs">(optional)</span>
                  </Label>
                  <Input
                    id="employeeIdValue"
                    value={employeeIdValue}
                    onChange={(e) => setEmployeeIdValue(e.target.value)}
                    placeholder="e.g. EMP-1234"
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional payroll/HR identifier. Shown on timesheet exports only.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="language" className="flex items-center gap-2">
                  <Globe className="h-4 w-4" />
                  {t('profile.language')}
                </Label>
                <Select value={selectedLanguage} onValueChange={(v) => setSelectedLanguage(v as Language)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">{t('language.english')}</SelectItem>
                    <SelectItem value="es">{t('language.spanish')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>


              <div className="pt-4 border-t border-border space-y-3">
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2"
                  onClick={() => setShowChangePasswordModal(true)}
                >
                  <Lock className="h-4 w-4" />
                  Change Password
                </Button>

                {showImmediateChangeButton && (
                  <Button
                    variant="secondary"
                    className="w-full justify-start gap-2"
                    onClick={() => setShowImmediateResetModal(true)}
                  >
                    <ShieldAlert className="h-4 w-4" />
                    Change Password Immediately
                  </Button>
                )}

                {canShowDeleteAccount && (
                  <Button
                    variant="destructive"
                    className="w-full justify-start gap-2"
                    onClick={() => setDeleteDialogOpen(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete Account
                  </Button>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex gap-3 flex-shrink-0">
            <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
              Cancel
            </Button>
            <Button onClick={handleSave} className="flex-1" disabled={isLoading}>
              {isLoading ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ChangePasswordModal
        open={showChangePasswordModal}
        onOpenChange={setShowChangePasswordModal}
        userEmail={impersonatedUser?.email || profile?.email || ''}
        userPhone={phone}
      />

      {showImmediateChangeButton && (
        <ImmediatePasswordChangeModal
          open={showImmediateResetModal}
          onOpenChange={setShowImmediateResetModal}
          userEmail={impersonatedUser?.email || profile?.email || user?.email || ''}
          userName={impersonatedUser?.full_name ?? profile?.full_name ?? null}
        />
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={(o) => !deleteLoading && setDeleteDialogOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteDialogTitle}</AlertDialogTitle>
            <AlertDialogDescription>{deleteDialogBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDeleteOwnAccount();
              }}
              disabled={deleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteLoading ? 'Deleting…' : 'Yes, delete my account'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SmsConsentDialog
        open={smsConsentDialogOpen}
        onOpenChange={setSmsConsentDialogOpen}
        phoneNumber={phone}
        onAgree={() => {
          setSmsConsentDialogOpen(false);
          performSave(true);
        }}
        onCancel={() => {
          // user declined consent; do not save phone change
        }}
      />
    </>

  );
};

export default ManageProfileModal;
