import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

const { app } = await createApp();
let n = 0;
const authed = (token: string) => ({ Authorization: `Bearer ${token}` });

async function signUp() {
  const res = await request(app)
    .post("/auth/signup")
    .send({ email: `empnum-${Date.now()}-${n++}@example.com`, password: "hunter22", fullName: "Emp Num" });
  return res.body.token as string;
}

/** The original's optional Employee ID: kept on the user's employee record, shown on timesheets. */
describe("profile: employee ID", () => {
  it("saves it to the caller's employee record and reads it back", async () => {
    const token = await signUp();
    const created = await request(app).post("/companies").set(authed(token)).send({ name: "EmpNum Co", companyType: "sub" });
    const companyId = created.body.company.id as string;

    const saved = await request(app).patch("/auth/profile").set(authed(token)).send({ employeeNumber: "  EMP-1234 " });
    expect(saved.status).toBe(200);
    expect(saved.body.employeeNumber).toBe("EMP-1234");

    const profile = await request(app).get("/auth/profile").set(authed(token));
    expect(profile.body).toMatchObject({ employeeNumber: "EMP-1234", hasEmployeeRecord: true });

    const roster = await request(app).get(`/companies/${companyId}/employees`).set(authed(token));
    expect(roster.body.employees[0].employeeNumber).toBe("EMP-1234");

    const cleared = await request(app).patch("/auth/profile").set(authed(token)).send({ employeeNumber: "" });
    expect(cleared.body.employeeNumber).toBeNull();
  });

  it("has nothing to store it on before you join a company", async () => {
    const token = await signUp();
    const res = await request(app).patch("/auth/profile").set(authed(token)).send({ employeeNumber: "EMP-9" });
    expect(res.status).toBe(200);
    expect(res.body.employeeNumber).toBeNull();
    const profile = await request(app).get("/auth/profile").set(authed(token));
    expect(profile.body.hasEmployeeRecord).toBe(false);
  });

  it("rejects one longer than 40 characters", async () => {
    const token = await signUp();
    const res = await request(app).patch("/auth/profile").set(authed(token)).send({ employeeNumber: "X".repeat(41) });
    expect(res.status).toBe(400);
  });
});
