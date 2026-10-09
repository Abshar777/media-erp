"""Ad Reports — Meta-style performance numbers entered daily by the team."""
from typing import Literal, Optional

from pydantic import BaseModel

Extra = Literal["impressions", "reach", "clicks"]


class CreateAdReportRequest(BaseModel):
    # "ad": numbers are entered daily. "account": a Meta ad account whose
    # numbers are the sum of the ads inside it (nothing is typed for it).
    kind: Literal["ad", "account"] = "ad"
    name: str
    # The main team first. `team_id` alone still works (one team).
    team_id: str = ""
    team_ids: list[str] = []
    # Owner first, then anyone else who helps (up to 6). Ads: they enter the
    # numbers and are reminded. Accounts (optional): they see and update its ads.
    assignees: list[str] = []
    start_date: str = ""                  # IST calendar day, YYYY-MM-DD (ads)
    account_id: Optional[str] = None      # ads: the account it belongs to (same team), or none
    ad_account_ref: Optional[str] = None  # accounts: e.g. "act_1234567890" as shown in Ads Manager
    end_date: Optional[str] = None        # None = until someone ends it
    # Leads + Amount spent are always tracked; these are optional extras.
    extra_metrics: list[Extra] = []
    reminder_due: str = "12:00"           # stage 1, IST HH:MM — the assigned people
    reminder_escalate: str = "17:00"      # stage 2, IST HH:MM — they and the team leader(s)


class UpdateAdReportRequest(BaseModel):
    action: Optional[Literal["pause", "resume", "end"]] = None
    name: Optional[str] = None
    account_id: Optional[str] = None      # ads: move into this account
    clear_account: bool = False           # ads: take it out of its account
    ad_account_ref: Optional[str] = None  # accounts
    team_ids: Optional[list[str]] = None  # main team first
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


class CreativeRequest(BaseModel):
    """A file the browser has already uploaded straight to R2 (lib/directUpload)."""
    key: str
    filename: str = ""
    size: int = 0
    content_type: str = ""
    url: str = ""
    backend: str = "r2"
