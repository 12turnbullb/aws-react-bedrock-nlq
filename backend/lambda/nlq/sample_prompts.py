sample_queries = """
Example SQL Queries:
1. Query: What was the total donation amount for the New Year Kickstart campaign?

    select sum(d.donation_amount) as total_donation_amount
    from sample_donations d 
    left join sample_campaigns c on d.campaign_id = c.campaign_id
    where lower(campaign_name) like 'new year kickstart%'
    group by c.campaign_id, c.campaign_name
     
   Expected Result:
   | total_donation_amount |
   |-----------------------|
   | 12425                 | 
   
   
"""



schemas = """

### **Table Schemas**

**sample_campaigns**
[
  {
    "Name": "campaign_id",
    "Type": "bigint"
  },
  {
    "Name": "campaign_name",
    "Type": "string"
  },
  {
    "Name": "startdate",
    "Type": "string"
  },
  {
    "Name": "enddate",
    "Type": "string"
  },
  {
    "Name": "goalamount",
    "Type": "bigint"
  }
]

**sample_donations**
[
  {
    "Name": "donor_id",
    "Type": "bigint"
  },
  {
    "Name": "campaign_id",
    "Type": "bigint"
  },
  {
    "Name": "donation_amount",
    "Type": "bigint"
  },
  {
    "Name": "payment_method",
    "Type": "string"
  },
  {
    "Name": "transaction_date",
    "Type": "string"
  }
]


**sample_donors**
[
  {
    "Name": "donor_id",
    "Type": "bigint"
  },
  {
    "Name": "first_name",
    "Type": "string"
  },
  {
    "Name": "last_name",
    "Type": "string"
  },
  {
    "Name": "city",
    "Type": "string"
  },
  {
    "Name": "state",
    "Type": "string"
  },
  {
    "Name": "zip_code",
    "Type": "bigint"
  },
  {
    "Name": "gender",
    "Type": "string"
  },
  {
    "Name": "age_group",
    "Type": "string"
  },
  {
    "Name": "income_level",
    "Type": "string"
  }
]

**sample_events**
[
  {
    "Name": "event_id",
    "Type": "bigint"
  },
  {
    "Name": "event_name",
    "Type": "string"
  },
  {
    "Name": "event_date",
    "Type": "string"
  },
  {
    "Name": "location",
    "Type": "string"
  },
  {
    "Name": "campaign_id",
    "Type": "bigint"
  }
]

**sample_registration**
[
  {
    "Name": "event_id",
    "Type": "bigint"
  },
  {
    "Name": "donor_id",
    "Type": "bigint"
  }
]

"""