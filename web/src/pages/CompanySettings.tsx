import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/toaster";
import { ArrowLeft, RefreshCw } from "lucide-react";

const PERMISSION_LEVELS = ["basic", "standard", "level_1", "partial", "full", "account_holder"] as const;

interface Employee {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  linkedUserId: string | null;
}

interface Member {
  userId: string;
  email: string;
  fullName: string | null;
  permissionLevel: string;
  isCompanyCreator: boolean;
}

/** `GET /companies/:id/employees` already answers in camelCase. */
interface Employee {
  id: string;
  companyId: string;
  name: string;
  email: string | null;
  phone: string | null;
  linkedUserId: string | null;
}

export default function CompanySettings() {
  const { user, isAccountHolder } = useAuth();
  const { toast } = useToast();
  const companyId = user?.companyId ?? null;

  const [company, setCompany] = useState<{ id: string; name: string; companyType: string } | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [newEmployeeName, setNewEmployeeName] = useState("");
  const [newEmployeeEmail, setNewEmployeeEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    try {
      const [companyRow, membersRes, employeesRes] = await Promise.all([
        supabase.from("companies").select("*").eq("id", companyId).maybeSingle(),
        api.get<{ members: Member[] }>(`/companies/${companyId}/members`),
        api.get<{ employees: Employee[] }>(`/companies/${companyId}/employees`),
      ]);
      setCompany(companyRow as typeof company);
      setMembers(membersRes.members);
      setEmployees(employeesRes.employees);
    } catch (err) {
      toast({
        title: "Could not load company settings",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [companyId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateMember(userId: string, permissionLevel: string) {
    setBusy(true);
    try {
      await api.patch(`/companies/${companyId}/members/${userId}`, { permissionLevel });
      await load();
      toast({ title: "Permissions updated" });
    } catch (err) {
      toast({
        title: "Could not update permissions",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function addEmployee(event: React.FormEvent) {
    event.preventDefault();
    if (!newEmployeeName.trim()) return;
    setBusy(true);
    try {
      await supabase.from("employees").insert({
        company_id: companyId,
        name: newEmployeeName.trim(),
        email: newEmployeeEmail.trim() || null,
      });
      setNewEmployeeName("");
      setNewEmployeeEmail("");
      await load();
      toast({ title: "Employee added" });
    } catch (err) {
      toast({
        title: "Could not add that employee",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function removeEmployee(id: string) {
    setBusy(true);
    try {
      await supabase.from("employees").delete().eq("id", id);
      await load();
      toast({ title: "Employee removed" });
    } catch (err) {
      toast({
        title: "Could not remove that employee",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 p-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/dashboard">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Dashboard
              </Link>
            </Button>
            <h1 className="text-lg font-bold">Company settings</h1>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 p-4">
        {!companyId ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">
              You are not part of a company yet.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Company</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                ) : (
                  <div className="flex items-center gap-3">
                    <p className="font-medium">{company?.name ?? "Unknown"}</p>
                    <Badge variant="secondary">{company?.companyType === "gc" ? "General contractor" : "Subcontractor"}</Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Members</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {members.map((member) => (
                    <li key={member.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div>
                        <p className="font-medium">{member.fullName ?? member.email}</p>
                        <p className="text-sm text-muted-foreground">{member.email}</p>
                      </div>
                      {isAccountHolder && !member.isCompanyCreator ? (
                        <Select
                          value={member.permissionLevel}
                          disabled={busy}
                          onValueChange={(value) => void updateMember(member.userId, value)}
                        >
                          <SelectTrigger className="w-44">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PERMISSION_LEVELS.map((level) => (
                              <SelectItem key={level} value={level}>
                                {level.replace("_", " ")}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline">
                          {member.isCompanyCreator ? "Creator" : member.permissionLevel.replace("_", " ")}
                        </Badge>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Employees</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {employees.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No employees yet. Add the crews you schedule.</p>
                ) : (
                  <ul className="divide-y">
                    {employees.map((employee) => (
                      <li key={employee.id} className="flex items-center justify-between gap-3 py-3">
                        <div>
                          <p className="font-medium">{employee.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {employee.email ?? employee.phone ?? "No contact details"}
                            {employee.linkedUserId ? " · linked to an account" : ""}
                          </p>
                        </div>
                        {isAccountHolder && (
                          <Button variant="outline" size="sm" disabled={busy} onClick={() => void removeEmployee(employee.id)}>
                            Remove
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {isAccountHolder && (
                  <form onSubmit={addEmployee} className="flex flex-wrap items-end gap-2 border-t pt-4">
                    <div className="min-w-40 flex-1 space-y-2">
                      <Label htmlFor="employeeName">Name</Label>
                      <Input
                        id="employeeName"
                        value={newEmployeeName}
                        onChange={(e) => setNewEmployeeName(e.target.value)}
                        required
                      />
                    </div>
                    <div className="min-w-40 flex-1 space-y-2">
                      <Label htmlFor="employeeEmail">Email</Label>
                      <Input
                        id="employeeEmail"
                        type="email"
                        value={newEmployeeEmail}
                        onChange={(e) => setNewEmployeeEmail(e.target.value)}
                        placeholder="Optional, used to link their account"
                      />
                    </div>
                    <Button type="submit" disabled={busy}>
                      Add
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
      <Toaster />
    </div>
  );
}