"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Activity,
  Mail,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
} from "lucide-react";

export default function ResetPasswordPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [email, setEmail] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setIsLoading(false);
    setIsSubmitted(true);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md space-y-8">
        {/* Logo */}
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Activity className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-foreground">
              {isSubmitted ? "Check your email" : "Reset your password"}
            </h1>
            <p className="mt-1 text-muted-foreground">
              {isSubmitted
                ? "We've sent you a password reset link"
                : "Enter your email to receive a reset link"}
            </p>
          </div>
        </div>

        {/* Form Card */}
        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          {!isSubmitted ? (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="email"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10 h-11 bg-secondary/50 border-border focus:bg-background transition-colors"
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-11 bg-primary hover:bg-primary/90 text-primary-foreground font-medium transition-all"
                disabled={isLoading}
              >
                {isLoading ? (
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    Sending link...
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    Send reset link
                    <ArrowRight className="h-4 w-4" />
                  </div>
                )}
              </Button>
            </form>
          ) : (
            <div className="space-y-6 text-center">
              <div className="flex justify-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                  <CheckCircle2 className="h-7 w-7 text-primary" />
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-muted-foreground">
                  We sent a password reset link to
                </p>
                <p className="font-medium text-foreground">{email}</p>
              </div>

              <div className="space-y-3 pt-2">
                <p className="text-sm text-muted-foreground">
                  {"Didn't receive the email? Check your spam folder or"}
                </p>
                <Button
                  variant="outline"
                  onClick={() => setIsSubmitted(false)}
                  className="bg-secondary/30 border-border hover:bg-secondary/50 transition-colors"
                >
                  Try another email
                </Button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-center">
          <Link
            href="/login"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to login
          </Link>
        </div>
      </div>
    </div>
  );
}
