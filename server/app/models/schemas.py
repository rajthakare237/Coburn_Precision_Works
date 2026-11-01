from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime

class Ticket(BaseModel):
    ticketId: str
    title: str
    description: str
    machineId: str
    machineModel: str
    severity: str
    status: str
    reportedBy: str
    createdAt: datetime
    updatedAt: datetime

class WorkOrder(BaseModel):
    workOrderId: str
    sourceTicketId: str
    machineId: str
    machineModel: str
    title: str
    priority: str
    status: str
    assignedTechnician: str
    estimatedHours: float
    slaDeadline: datetime
    resolutionNotes: str
    createdAt: datetime
    updatedAt: datetime