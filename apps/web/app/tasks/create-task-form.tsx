// apps/web/app/tasks/create-task-form.tsx
"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface CreateTaskFormProps {
  sessionId: string;
}

export function CreateTaskForm({ sessionId }: CreateTaskFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const formData = new FormData(e.currentTarget);
    const title = formData.get("title") as string;
    const prd = formData.get("prd") as string;
    const priority = formData.get("priority") as string || "P2";

    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, title, prd, priority }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError((data as { error: string }).error ?? "创建失败");
        return;
      }

      const data = await res.json();
      router.push(`/tasks/${(data as { task: { id: string } }).task.id}`);
    } catch {
      setError("网络错误");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">创建开发任务</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">任务标题</Label>
            <Input
              id="title"
              name="title"
              placeholder="例如：实现用户注册 API"
              required
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="prd">需求描述 (PRD)</Label>
            <Textarea
              id="prd"
              name="prd"
              placeholder="详细描述需求、接口规格、验收标准..."
              required
              rows={6}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="priority">优先级</Label>
            <select
              id="priority"
              name="priority"
              defaultValue="P2"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors"
            >
              <option value="P0">P0 — 紧急</option>
              <option value="P1">P1 — 高</option>
              <option value="P2">P2 — 中</option>
              <option value="P3">P3 — 低</option>
            </select>
          </div>
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <Button type="submit" disabled={isSubmitting} className="w-full">
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            {isSubmitting ? "创建中..." : "创建任务"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
