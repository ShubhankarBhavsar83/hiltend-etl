import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useApiClient } from "../hooks/useApiClient";
import axios from "axios";

export type AccessRole = "viewer" | "user" | "admin" | "owner";

interface Member {
    id: string;
    name: string;
    email: string;
    role: AccessRole;
}

interface CollabModalProps {
    isOpen: boolean;
    onClose: () => void;
    datasetName: string;
    currentUserEmail: string;
    currentRole: AccessRole;
}

export default function CollaborationModal({ isOpen, onClose, datasetName, currentUserEmail, currentRole }: CollabModalProps) {
    const apiClient = useApiClient();
    const [members, setMembers] = useState<Member[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [inviteEmail, setInviteEmail] = useState("");
    const [inviteRole, setInviteRole] = useState<AccessRole>("viewer");
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");



    const fetchMembers = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await apiClient.get(`/api/v1/datasets/${datasetName}/members`);
            setMembers(res.data.members);
            setError("");
        } catch (err) {
            if (axios.isAxiosError(err)) {
                setError("Failed to load members.");
            } else {
                throw error;
            }
        } finally {
            setIsLoading(false);
        }
    }, [apiClient, datasetName, error]);

    useEffect(() => {
        if (isOpen && datasetName) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            fetchMembers();
        }
    }, [isOpen, datasetName, fetchMembers]);

    const handleInvite = async () => {
        if (!inviteEmail.trim()) return;
        try {
            await apiClient.post(`/api/v1/datasets/${datasetName}/members`, {
                email: inviteEmail,
                role: inviteRole
            });
            setSuccess(`Invited ${inviteEmail} successfully!`);
            setInviteEmail("");
            fetchMembers();
            setTimeout(() => setSuccess(""), 3000);
        } catch (err) {
            if (axios.isAxiosError(err)) {
                setError(err.response?.data?.detail || "Failed to invite user.");
                setTimeout(() => setError(""), 4000);
            } else {
                throw error;
            }

        }
    };

    const handleUpdateRole = async (userId: string, newRole: AccessRole) => {
        try {
            await apiClient.put(`/api/v1/datasets/${datasetName}/members/${userId}`, { role: newRole });
            fetchMembers();
        } catch (err) {

            if (axios.isAxiosError(err)) {
                setError(err.response?.data?.detail || "Failed to update role.");
                setTimeout(() => setError(""), 4000);
            } else {
                throw error;
            }

        }
    };

    const handleRemove = async (userId: string) => {
        try {
            await apiClient.delete(`/api/v1/datasets/${datasetName}/members/${userId}`);
            fetchMembers();
        } catch (err) {

            if (axios.isAxiosError(err)) {
                setError(err.response?.data?.detail || "Failed to remove user.");
                setTimeout(() => setError(""), 4000);
            } else {
                throw error;
            }


        }
    };

    if (!isOpen) return null;

    const canInvite = currentRole === "admin" || currentRole === "owner";

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">

                {/* Header */}
                <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900">Manage Access</h2>
                        <p className="text-xs text-gray-500">Dataset: <span className="font-mono text-blue-600">{datasetName}</span></p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl font-bold">&times;</button>
                </div>

                {/* Invite Section */}
                {canInvite && (
                    <div className="p-6 bg-gray-50 border-b border-gray-100 flex flex-col gap-3">
                        <h3 className="text-sm font-semibold text-gray-700">Invite new member</h3>
                        <div className="flex gap-2">
                            <Input
                                placeholder="Email address..."
                                value={inviteEmail}
                                onChange={(e) => setInviteEmail(e.target.value)}
                                className="flex-1"
                            />
                            <select
                                className="rounded-md border border-gray-300 bg-white px-3 text-sm shadow-sm"
                                value={inviteRole}
                                onChange={(e) => setInviteRole(e.target.value as AccessRole)}
                            >
                                <option value="viewer">Viewer</option>
                                <option value="user">User</option>
                                {currentRole === "owner" && <option value="admin">Admin</option>}
                            </select>
                            <Button onClick={handleInvite} className="bg-blue-600 hover:bg-blue-700 text-white">Invite</Button>
                        </div>
                        {error && <Alert variant="destructive" className="py-2"><AlertDescription>{error}</AlertDescription></Alert>}
                        {success && <Alert className="py-2 bg-green-50 text-green-700 border-green-200"><AlertDescription>{success}</AlertDescription></Alert>}
                    </div>
                )}

                {/* Member List */}
                <div className="p-6 overflow-y-auto flex-1">
                    <h3 className="text-sm font-semibold text-gray-700 mb-4">Current Members</h3>
                    {isLoading ? (
                        <div className="text-center text-sm text-gray-400">Loading members...</div>
                    ) : (
                        <div className="flex flex-col gap-4">
                            {members.map(member => {
                                const isMe = member.email.toLowerCase() === currentUserEmail.toLowerCase();
                                const canEdit =
                                    !isMe &&
                                    currentRole === "owner" ||
                                    (currentRole === "admin" && member.role !== "admin" && member.role !== "owner");

                                return (
                                    <div key={member.id} className="flex items-center justify-between group">
                                        <div className="flex flex-col">
                                            <span className="text-sm font-medium text-gray-900">
                                                {member.name} {isMe && <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded ml-1">You</span>}
                                            </span>
                                            <span className="text-xs text-gray-500 font-mono">{member.email}</span>
                                        </div>

                                        <div className="flex items-center gap-2">
                                            {canEdit ? (
                                                <select
                                                    className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700"
                                                    value={member.role}
                                                    onChange={(e) => handleUpdateRole(member.id, e.target.value as AccessRole)}
                                                >
                                                    <option value="viewer">Viewer</option>
                                                    <option value="user">User</option>
                                                    {currentRole === "owner" && <option value="admin">Admin</option>}
                                                </select>
                                            ) : (
                                                <span className="text-xs font-semibold px-2 py-1 bg-gray-100 text-gray-600 rounded-md capitalize">
                                                    {member.role}
                                                </span>
                                            )}

                                            {canEdit && (
                                                <button onClick={() => handleRemove(member.id)} className="text-gray-400 hover:text-red-600 px-2">
                                                    &times;
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}