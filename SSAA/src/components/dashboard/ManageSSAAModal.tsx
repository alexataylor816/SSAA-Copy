import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Mail, CreditCard, UserCog, Ban } from 'lucide-react';
import ManageCorrespondenceModal from './ManageCorrespondenceModal';
import ManageSubscriptionsModal from './ManageSubscriptionsModal';
import ManageOperatorsModal from './ManageOperatorsModal';
import ManageCancellationRequestsModal from './ManageCancellationRequestsModal';
import { usePendingCancellationCount } from '@/hooks/usePendingCancellationCount';

interface ManageSSAAModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ManageSSAAModal = ({ open, onOpenChange }: ManageSSAAModalProps) => {
  const { isOMO, isMainOperator } = useAuth();
  const [correspondenceOpen, setCorrespondenceOpen] = useState(false);
  const [subscriptionsOpen, setSubscriptionsOpen] = useState(false);
  const [operatorsOpen, setOperatorsOpen] = useState(false);
  const [cancellationsOpen, setCancellationsOpen] = useState(false);
  const { count: pendingCancellations } = usePendingCancellationCount();

  const canManageOperators = isOMO || isMainOperator;

  const handleOpenChild = (setter: (v: boolean) => void) => {
    onOpenChange(false);
    setTimeout(() => setter(true), 150);
  };

  const handleBackToSSAA = (setter: (v: boolean) => void) => {
    setter(false);
    setTimeout(() => onOpenChange(true), 150);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Manage SSAA</DialogTitle>
            <DialogDescription>
              Platform administration tools
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <Card
              className="cursor-pointer hover:bg-accent transition-colors"
              onClick={() => handleOpenChild(setCorrespondenceOpen)}
            >
              <CardHeader className="p-4 flex flex-row items-center gap-3">
                <Mail className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                <div>
                  <CardTitle className="text-sm">Correspondence</CardTitle>
                  <CardDescription className="text-xs">Manage email templates and notifications</CardDescription>
                </div>
              </CardHeader>
            </Card>

            <Card
              className="cursor-pointer hover:bg-accent transition-colors"
              onClick={() => handleOpenChild(setSubscriptionsOpen)}
            >
              <CardHeader className="p-4 flex flex-row items-center gap-3">
                <CreditCard className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                <div>
                  <CardTitle className="text-sm">Subscriptions</CardTitle>
                  <CardDescription className="text-xs">Manage subscription plans and billing</CardDescription>
                </div>
              </CardHeader>
            </Card>

            {canManageOperators && (
              <Card
                className="cursor-pointer hover:bg-accent transition-colors"
                onClick={() => handleOpenChild(setOperatorsOpen)}
              >
                <CardHeader className="p-4 flex flex-row items-center gap-3">
                  <UserCog className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  <div>
                    <CardTitle className="text-sm">Operators</CardTitle>
                    <CardDescription className="text-xs">Manage operator accounts and permissions</CardDescription>
                  </div>
                </CardHeader>
              </Card>
            )}

            <Card
              className="cursor-pointer hover:bg-accent transition-colors relative"
              onClick={() => handleOpenChild(setCancellationsOpen)}
            >
              {pendingCancellations > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-xs font-semibold flex items-center justify-center">
                  {pendingCancellations}
                </span>
              )}
              <CardHeader className="p-4 flex flex-row items-center gap-3">
                <Ban className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                <div>
                  <CardTitle className="text-sm">Cancellation Requests</CardTitle>
                  <CardDescription className="text-xs">Review and approve company account deletions</CardDescription>
                </div>
              </CardHeader>
            </Card>
          </div>
        </DialogContent>
      </Dialog>

      <ManageCorrespondenceModal open={correspondenceOpen} onOpenChange={setCorrespondenceOpen} onBack={() => handleBackToSSAA(setCorrespondenceOpen)} />
      <ManageSubscriptionsModal open={subscriptionsOpen} onOpenChange={setSubscriptionsOpen} onBack={() => handleBackToSSAA(setSubscriptionsOpen)} />
      {canManageOperators && (
        <ManageOperatorsModal open={operatorsOpen} onOpenChange={setOperatorsOpen} readOnly={!isOMO} onBack={() => handleBackToSSAA(setOperatorsOpen)} />
      )}
      <ManageCancellationRequestsModal open={cancellationsOpen} onOpenChange={setCancellationsOpen} onBack={() => handleBackToSSAA(setCancellationsOpen)} />
    </>
  );
};

export default ManageSSAAModal;
