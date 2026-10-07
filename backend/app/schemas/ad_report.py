"""Ad Reports — Meta-style performance numbers entered daily by the team."""
from typing import Literal, Optional

from pydantic import BaseModel

Extra = Literal["impressions", "reach", "clicks"]


class CreateAdReportRequest(BaseModel):
    name: str
    team_id: str
    # Owner first, then an optional backup. Both can enter, both are reminded.
    assignees: list[str]
    start_date: str                       # IST calendar day, YYYY-MM-DD
    end_date: Optional[str] = None        # None = until someone ends it
    # Leads + Amount spent are always tracked; these are optional extras.
    extra_metrics: list[Extra] = []
    reminder_due: str = "12:00"           # stage 1, IST HH:MM — the assigned people
    reminder_escalate: str = "17:00"      # stage 2, IST HH:MM — they and the team leader(s)


class UpdateAdReportRequest(BaseModel):
    action: Optional[Literal["pause", "resume", "end"]] = None
    name: Optional[str] = None
    assignees: Optional[list[str]] = None
    end_date: Optional[str] = None
    clear_end_date: bool = False
    extra_metrics: Optional[list[Extra]] = None
    reminder_due: Optional[str] = None
    reminder_escalate: Optional[str] = None


class EntryRequest(BaseModel):
    """One day's numbers. Spend is in rupees (up to 2 decimals); it is stored in paise."""
    leads: Optional[int] = None
    spend: Optional[float | str] = None
    impressions: Optional[int] = None
    reach: Optional[int] = None
    clicks: Optional[int] = None
    campaign_off: bool = False
    note: str = ""
