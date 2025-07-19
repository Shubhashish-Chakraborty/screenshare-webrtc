import RoomComponent from "@/components/Room";

export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <RoomComponent params={{
        id: id
    }}  />;
}
