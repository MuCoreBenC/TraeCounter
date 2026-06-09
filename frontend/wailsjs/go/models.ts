export namespace counter {
	
	export class UserTodayCount {
	    user_id: string;
	    name: string;
	    avatar_url: string;
	    remark: string;
	    first_seen: string;
	    last_active: string;
	    auto: number;
	    manual: number;
	    total: number;
	    is_tracking: boolean;
	    learned_quota: number;
	
	    static createFrom(source: any = {}) {
	        return new UserTodayCount(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.user_id = source["user_id"];
	        this.name = source["name"];
	        this.avatar_url = source["avatar_url"];
	        this.remark = source["remark"];
	        this.first_seen = source["first_seen"];
	        this.last_active = source["last_active"];
	        this.auto = source["auto"];
	        this.manual = source["manual"];
	        this.total = source["total"];
	        this.is_tracking = source["is_tracking"];
	        this.learned_quota = source["learned_quota"];
	    }
	}

}

export namespace main {
	
	export class TodayCountResult {
	    auto: number;
	    manual: number;
	    total: number;
	
	    static createFrom(source: any = {}) {
	        return new TodayCountResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.auto = source["auto"];
	        this.manual = source["manual"];
	        this.total = source["total"];
	    }
	}
	export class UserMessageResult {
	    user_id: string;
	    dates: Record<string, number>;
	
	    static createFrom(source: any = {}) {
	        return new UserMessageResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.user_id = source["user_id"];
	        this.dates = source["dates"];
	    }
	}

}

export namespace store {
	
	export class LedgerDateCount {
	    date: string;
	    count: number;
	
	    static createFrom(source: any = {}) {
	        return new LedgerDateCount(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.date = source["date"];
	        this.count = source["count"];
	    }
	}
	export class LedgerHourlyCount {
	    hour: number;
	    count: number;
	
	    static createFrom(source: any = {}) {
	        return new LedgerHourlyCount(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hour = source["hour"];
	        this.count = source["count"];
	    }
	}
	export class LedgerMonthCount {
	    month: string;
	    count: number;
	
	    static createFrom(source: any = {}) {
	        return new LedgerMonthCount(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.month = source["month"];
	        this.count = source["count"];
	    }
	}

}

export namespace traedb {
	
	export class QuotaInfo {
	    quota: number;
	    used: number;
	    next_flash: number;
	    user_type: number;
	    dimension: string;
	    is_exhausted: boolean;
	    identity_str: string;
	    fast_request_per: number;
	    exhaust_source: string;
	
	    static createFrom(source: any = {}) {
	        return new QuotaInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.quota = source["quota"];
	        this.used = source["used"];
	        this.next_flash = source["next_flash"];
	        this.user_type = source["user_type"];
	        this.dimension = source["dimension"];
	        this.is_exhausted = source["is_exhausted"];
	        this.identity_str = source["identity_str"];
	        this.fast_request_per = source["fast_request_per"];
	        this.exhaust_source = source["exhaust_source"];
	    }
	}

}

