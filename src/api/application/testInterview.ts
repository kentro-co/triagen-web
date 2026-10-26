/**
 * Test interviews created from the dashboard.
 *
 * Inserted straight into Supabase with the signed-in user's session: RLS only
 * lets a company add candidates to its own jobs, so this never works logged
 * out, and the public application endpoint (and its one-application-per-email
 * rule) is untouched. The interview plan is generated on the first
 * /interview/start, exactly as for a real application.
 */

import { supabase } from "../../integrations/supabase/client";

/** Test candidates are recognizable by this e-mail domain and note (no schema change). */
export const TEST_CANDIDATE_EMAIL_DOMAIN = "teste.triagen.app";
export const TEST_CANDIDATE_NOTE = "Candidato de teste gerado pelo dashboard. Não é um candidato real.";

export function isTestCandidateEmail(email: string): boolean {
    return email.toLowerCase().endsWith(`@${TEST_CANDIDATE_EMAIL_DOMAIN}`);
}

export async function createTestInterview(params: {
    jobId: string;
    name: string;
    resumeText: string;
}): Promise<{ candidateId: string; interviewUrl: string }> {
    // A unique address per test, so the (job_id, email) uniqueness never blocks a retry.
    const suffix = crypto.randomUUID().slice(0, 8);
    const { data, error } = await supabase
        .from("candidates")
        .insert({
            job_id: params.jobId,
            name: params.name,
            email: `teste-${suffix}@${TEST_CANDIDATE_EMAIL_DOMAIN}`,
            resume_url: params.resumeText,
            notes: TEST_CANDIDATE_NOTE,
        })
        .select("id, interview_id")
        .single();

    if (error || !data) {
        throw new Error(error?.message || "Falha ao criar o candidato de teste");
    }

    return {
        candidateId: data.id,
        interviewUrl: `${window.location.origin}/interview/${data.interview_id}`,
    };
}
