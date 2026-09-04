import { WorkstreamDetail } from "@/components/workstream-detail";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <WorkstreamDetail id={(await params).id} />; }
