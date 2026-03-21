import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const placeholderFaqs = [
  {
    question: "What is this page for?",
    answer:
      "This is a placeholder FAQ page for Open Harness. It gives us a stable place to collect common setup, workflow, and troubleshooting answers.",
  },
  {
    question: "Why are the answers still short?",
    answer:
      "We have not published the full FAQ yet. These starter entries keep the route in place while we flesh out the real documentation.",
  },
  {
    question: "Where should I look in the meantime?",
    answer:
      "You can start from the homepage, sign in to explore the product, or browse the GitHub repository for implementation details and examples.",
  },
] as const;

export const metadata: Metadata = {
  title: "FAQ",
  description: "Placeholder frequently asked questions for Open Harness.",
};

export default function FaqPage() {
  return (
    <main className="min-h-screen bg-background px-6 py-16 text-foreground sm:px-10">
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <div className="space-y-4">
          <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
            FAQ
          </p>
          <div className="space-y-3">
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Frequently asked questions
            </h1>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground">
              We&apos;re still building this page out. For now, these
              placeholder answers mark the home for future product, setup, and
              troubleshooting guidance.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/">Back to Open Harness</Link>
          </Button>
        </div>

        <div className="grid gap-4">
          {placeholderFaqs.map((item) => (
            <Card key={item.question}>
              <CardHeader>
                <CardTitle className="text-lg">{item.question}</CardTitle>
                <CardDescription>Placeholder answer</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-6 text-muted-foreground">
                  {item.answer}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </main>
  );
}
